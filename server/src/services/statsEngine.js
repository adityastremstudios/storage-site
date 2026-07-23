// Statistics Engine — points, configurable tie-breakers, penalties, standings,
// top fraggers, MVP. All previous exports are preserved.
import { prisma } from '../lib/prisma.js';

export const DEFAULT_PLACEMENT_POINTS = [10, 6, 5, 4, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];
export const COUNTED_STATUSES = ['COMPLETED', 'PUBLISHED', 'LOCKED'];

// Ordered tie-break chain. Overridable per point rule via PointRule.tiebreakers.
export const DEFAULT_TIEBREAKERS = ['points', 'wwcd', 'placementPoints', 'kills', 'lastPlacement'];

export const TIEBREAKER_LABELS = {
  points: 'total points',
  wwcd: 'WWCD count',
  placementPoints: 'placement points',
  kills: 'total kills',
  avgPlacement: 'average placement',
  lastPlacement: 'better last-match placement',
  damage: 'total damage',
};

// Stat keys tracked in PlayerStat.provided / TeamStat.provided. A key missing
// from that list means the source never sent it — it is "no data", not zero,
// so it must be excluded from averages and records.
export const PLAYER_STAT_KEYS = [
  'kills', 'damage', 'assists', 'knocks', 'revives', 'headshots', 'survivalTime',
  'deaths', 'knockedDown', 'longestKill', 'distance', 'heals', 'boosts',
  'selfDamage', 'teamDamage', 'clutches',
];
export const TEAM_STAT_KEYS = ['kills', 'damage', 'survivalTime', 'damageTaken'];

export function resolveRule(tournament) {
  const override = tournament?.pointsOverride;
  const rule = tournament?.pointRule;
  const tb = override?.tiebreakers || rule?.tiebreakers;
  return {
    placementPoints: override?.placementPoints || rule?.placementPoints || DEFAULT_PLACEMENT_POINTS,
    killPoint: override?.killPoint ?? rule?.killPoint ?? 1,
    tiebreakers: Array.isArray(tb) && tb.length ? tb : DEFAULT_TIEBREAKERS,
  };
}

export function computePoints(placement, kills, rule) {
  const pp = Array.isArray(rule.placementPoints) ? rule.placementPoints : DEFAULT_PLACEMENT_POINTS;
  const placementPoints = Number(pp[placement - 1] ?? 0);
  const killPoints = Number(kills) * Number(rule.killPoint ?? 1);
  return { placementPoints, killPoints, totalPoints: placementPoints + killPoints };
}

// Weighted impact score used to pick the match MVP. Null stats contribute
// nothing rather than dragging the score toward zero.
export function mvpScore(p) {
  const n = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);
  return n(p.kills) * 12 + n(p.damage) * 0.08 + n(p.assists) * 6
    + n(p.knocks) * 3 + n(p.revives) * 5 + n(p.headshots) * 2;
}

function compareBy(key, a, b) {
  switch (key) {
    case 'points': return b.totalPoints - a.totalPoints;
    case 'wwcd': return b.wwcd - a.wwcd;
    case 'placementPoints': return b.placementPoints - a.placementPoints;
    case 'kills': return b.totalKills - a.totalKills;
    case 'damage': return (b.totalDamage || 0) - (a.totalDamage || 0);
    case 'avgPlacement': return (a.avgPlacement || 999) - (b.avgPlacement || 999);
    case 'lastPlacement': return (a.lastPlacement ?? 999) - (b.lastPlacement ?? 999);
    default: return 0;
  }
}

/**
 * Rank rows using the configured chain and record WHICH rule broke each tie —
 * standings disputes are the number one source of arguments at a live event,
 * so the reason is stored and shown next to the rank.
 */
export function rankRows(rows, tiebreakers = DEFAULT_TIEBREAKERS) {
  const chain = Array.isArray(tiebreakers) && tiebreakers.length ? tiebreakers : DEFAULT_TIEBREAKERS;
  rows.sort((a, b) => {
    for (const key of chain) {
      const d = compareBy(key, a, b);
      if (d) return d;
    }
    return String(a.teamName).localeCompare(String(b.teamName));
  });

  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.tiebreakReason = null;
    const prev = rows[i - 1];
    if (!prev) return;
    if (compareBy('points', prev, r) !== 0) return;
    // Same points as the team above — find the rule that separated them.
    for (const key of chain) {
      if (key === 'points') continue;
      if (compareBy(key, prev, r) !== 0) {
        r.tiebreakReason = `tied on points, split by ${TIEBREAKER_LABELS[key] || key}`;
        return;
      }
    }
    r.tiebreakReason = 'tied on points, split by team name';
  });
  return rows;
}

async function loadPenalties(tournamentId, matchIds) {
  const rows = await prisma.penalty.findMany({
    where: {
      tournamentId,
      OR: [{ matchId: null }, { matchId: { in: matchIds.length ? matchIds : [-1] } }],
    },
    select: { teamId: true, points: true },
  });
  const byTeam = new Map();
  for (const p of rows) byTeam.set(p.teamId, (byTeam.get(p.teamId) || 0) + Number(p.points || 0));
  return byTeam;
}

export async function recalcStandings(tournamentId, scope = 'overall') {
  const matchWhere = { tournamentId, deletedAt: null, status: { in: COUNTED_STATUSES } };
  if (scope.startsWith('round:')) matchWhere.roundId = Number(scope.split(':')[1]);

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId }, include: { pointRule: true },
  });
  const rule = resolveRule(tournament);

  const [stats, entries] = await Promise.all([
    prisma.teamStat.findMany({
      where: { match: matchWhere },
      include: {
        match: { select: { id: true, matchNumber: true, roundId: true, endedAt: true, startedAt: true } },
        team: { select: { id: true, name: true } },
      },
    }),
    prisma.tournamentTeam.findMany({ where: { tournamentId }, include: { team: { select: { id: true, name: true } } } }),
  ]);

  const penalties = await loadPenalties(tournamentId, [...new Set(stats.map((s) => s.matchId))]);

  const byTeam = new Map();
  const ensure = (teamId, teamName) => {
    if (!byTeam.has(teamId)) {
      byTeam.set(teamId, {
        teamId, teamName, matchesPlayed: 0, totalKills: 0, totalDamage: 0, placementPoints: 0,
        killPoints: 0, totalPoints: 0, wwcd: 0, placementSum: 0, lastPlacement: null,
        lastOrder: -Infinity, penaltyPoints: 0, hasDamage: false,
      });
    }
    return byTeam.get(teamId);
  };
  for (const e of entries) ensure(e.teamId, e.team.name);

  for (const s of stats) {
    const row = ensure(s.teamId, s.team.name);
    row.matchesPlayed += 1;
    row.totalKills += s.kills;
    row.placementPoints += s.placementPoints;
    row.killPoints += s.killPoints;
    row.totalPoints += s.totalPoints;
    row.placementSum += s.placement;
    if (s.isWWCD) row.wwcd += 1;
    if ((s.provided || []).includes('damage')) { row.totalDamage += s.damage || 0; row.hasDamage = true; }
    // Chronological, not insertion order — re-imported matches get new ids but
    // keep their real play order.
    const order = (s.match.endedAt || s.match.startedAt || new Date(0)).getTime() + s.match.matchNumber;
    if (order > row.lastOrder) { row.lastOrder = order; row.lastPlacement = s.placement; }
  }

  for (const [teamId, points] of penalties) {
    if (!byTeam.has(teamId)) continue;
    const row = byTeam.get(teamId);
    row.penaltyPoints = points;
    row.totalPoints -= points;
  }

  const rows = rankRows([...byTeam.values()].map((r) => ({
    ...r,
    avgPlacement: r.matchesPlayed ? +(r.placementSum / r.matchesPlayed).toFixed(2) : 0,
  })), rule.tiebreakers);

  await prisma.$transaction([
    prisma.overallStanding.deleteMany({ where: { tournamentId, scope } }),
    prisma.overallStanding.createMany({
      data: rows.map((r) => ({
        tournamentId, scope, teamId: r.teamId, matchesPlayed: r.matchesPlayed,
        totalKills: r.totalKills, placementPoints: r.placementPoints, killPoints: r.killPoints,
        totalPoints: r.totalPoints, wwcd: r.wwcd, avgPlacement: r.avgPlacement,
        lastPlacement: r.lastPlacement, rank: r.rank,
        penaltyPoints: r.penaltyPoints, tiebreakReason: r.tiebreakReason,
      })),
    }),
  ]);
  return rows;
}

export async function recalcTournament(tournamentId, roundIds = []) {
  await recalcStandings(tournamentId, 'overall');
  // Always refresh every round scope that already exists, so moving or
  // deleting a match can never leave a stale round table behind.
  const rounds = await prisma.round.findMany({ where: { tournamentId }, select: { id: true } });
  const targets = new Set([...roundIds.filter(Boolean).map(Number), ...rounds.map((r) => r.id)]);
  for (const rid of targets) await recalcStandings(tournamentId, `round:${rid}`);
}

export async function getStandings(tournamentId, scope = 'overall') {
  const sel = { select: { id: true, name: true, shortName: true, slug: true, logoUrl: true, country: true } };
  let rows = await prisma.overallStanding.findMany({
    where: { tournamentId, scope }, orderBy: { rank: 'asc' }, include: { team: sel },
  });
  if (!rows.length) {
    // Only rebuild when the tournament actually has teams — otherwise an empty
    // tournament recalculated on every single request.
    const hasTeams = await prisma.tournamentTeam.count({ where: { tournamentId } });
    if (!hasTeams) return [];
    await recalcStandings(tournamentId, scope);
    rows = await prisma.overallStanding.findMany({
      where: { tournamentId, scope }, orderBy: { rank: 'asc' }, include: { team: sel },
    });
  }
  return rows;
}

// avg helpers that respect "no data" — null in, null out (never a fake 0)
const avg = (sum, count, hasData) => (hasData && count ? +(sum / count).toFixed(2) : null);

export async function getTopFraggers(tournamentId, limit = 10, roundId = null) {
  const matchWhere = { tournamentId, deletedAt: null, status: { in: COUNTED_STATUSES } };
  if (roundId) matchWhere.roundId = Number(roundId);

  const rows = await prisma.playerStat.findMany({
    where: { match: matchWhere },
    select: {
      playerId: true, kills: true, damage: true, assists: true, headshots: true,
      knocks: true, mvpScore: true, isMvp: true, provided: true,
    },
  });

  const byPlayer = new Map();
  for (const s of rows) {
    if (!byPlayer.has(s.playerId)) {
      byPlayer.set(s.playerId, {
        playerId: s.playerId, matches: 0, kills: 0, damage: 0, assists: 0,
        headshots: 0, knocks: 0, mvpScore: 0, mvpCount: 0, damageMatches: 0,
      });
    }
    const a = byPlayer.get(s.playerId);
    a.matches += 1;
    a.kills += s.kills;
    a.assists += s.assists;
    a.headshots += s.headshots;
    a.knocks += s.knocks;
    a.mvpScore += s.mvpScore;
    if (s.isMvp) a.mvpCount += 1;
    if ((s.provided || []).includes('damage')) { a.damage += s.damage || 0; a.damageMatches += 1; }
  }

  const sorted = [...byPlayer.values()]
    .sort((a, b) => b.kills - a.kills || b.damage - a.damage || b.mvpScore - a.mvpScore)
    .slice(0, limit);

  const players = await prisma.player.findMany({
    where: { id: { in: sorted.map((t) => t.playerId) } },
    include: { currentTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } } },
  });
  const pMap = new Map(players.map((p) => [p.id, p]));

  return sorted.map((t, i) => ({
    rank: i + 1,
    player: pMap.get(t.playerId) || { id: t.playerId, ign: 'Unknown' },
    matches: t.matches,
    kills: t.kills,
    damage: t.damageMatches ? Math.round(t.damage) : null,
    assists: t.assists,
    headshots: t.headshots,
    knocks: t.knocks,
    mvpCount: t.mvpCount,
    avgKills: +(t.kills / t.matches).toFixed(2),
    avgDamage: avg(t.damage, t.damageMatches, t.damageMatches > 0),
    mvpScore: Math.round(t.mvpScore),
  }));
}

export async function getTournamentMvp(tournamentId, limit = 5) {
  const grouped = await prisma.playerStat.groupBy({
    by: ['playerId'],
    where: { match: { tournamentId, deletedAt: null, status: { in: COUNTED_STATUSES } } },
    _sum: { mvpScore: true, kills: true, damage: true },
    _count: { _all: true },
  });
  grouped.sort((a, b) => (b._sum.mvpScore || 0) - (a._sum.mvpScore || 0));
  const top = grouped.slice(0, limit);
  const players = await prisma.player.findMany({
    where: { id: { in: top.map((t) => t.playerId) } },
    include: { currentTeam: { select: { name: true, shortName: true, logoUrl: true } } },
  });
  const pMap = new Map(players.map((p) => [p.id, p]));
  return top.map((t, i) => ({
    rank: i + 1, player: pMap.get(t.playerId), mvpScore: Math.round(t._sum.mvpScore || 0),
    kills: t._sum.kills || 0, damage: Math.round(t._sum.damage || 0), matches: t._count._all,
  }));
}

export async function getHeadToHead(tournamentId, teamAId, teamBId) {
  const stats = await prisma.teamStat.findMany({
    where: {
      teamId: { in: [teamAId, teamBId] },
      match: { tournamentId, deletedAt: null, status: { in: COUNTED_STATUSES } },
    },
    include: { match: { select: { id: true, matchNumber: true, round: { select: { name: true } } } } },
  });
  const byMatch = new Map();
  for (const s of stats) {
    if (!byMatch.has(s.matchId)) byMatch.set(s.matchId, { match: s.match });
    byMatch.get(s.matchId)[s.teamId] = s;
  }
  let aWins = 0; let bWins = 0; const matches = [];
  for (const [matchId, pair] of byMatch) {
    const a = pair[teamAId]; const b = pair[teamBId];
    if (!a || !b) continue;
    if (a.placement < b.placement) aWins += 1; else if (b.placement < a.placement) bWins += 1;
    matches.push({
      matchId,
      matchNumber: pair.match.matchNumber,
      round: pair.match.round?.name || null,
      a: { placement: a.placement, kills: a.kills, points: a.totalPoints },
      b: { placement: b.placement, kills: b.kills, points: b.totalPoints },
    });
  }
  matches.sort((x, y) => x.matchNumber - y.matchNumber);
  return { teamAId, teamBId, aWins, bWins, matchesCompared: matches.length, matches };
}
