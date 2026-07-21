// Statistics Engine — points calculation, tie-breakers, standings, top fraggers, MVP.
import { prisma } from '../lib/prisma.js';

export const DEFAULT_PLACEMENT_POINTS = [10, 6, 5, 4, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];
export const COUNTED_STATUSES = ['COMPLETED', 'PUBLISHED', 'LOCKED'];

export function resolveRule(tournament) {
  const override = tournament?.pointsOverride;
  const rule = tournament?.pointRule;
  return {
    placementPoints: override?.placementPoints || rule?.placementPoints || DEFAULT_PLACEMENT_POINTS,
    killPoint: override?.killPoint ?? rule?.killPoint ?? 1,
  };
}

export function computePoints(placement, kills, rule) {
  const pp = Array.isArray(rule.placementPoints) ? rule.placementPoints : DEFAULT_PLACEMENT_POINTS;
  const placementPoints = Number(pp[placement - 1] ?? 0);
  const killPoints = Number(kills) * Number(rule.killPoint ?? 1);
  return { placementPoints, killPoints, totalPoints: placementPoints + killPoints };
}

export function mvpScore(p) {
  // Weighted impact score used to pick the match MVP
  return (p.kills || 0) * 12 + (p.damage || 0) * 0.08 + (p.assists || 0) * 6
    + (p.knocks || 0) * 3 + (p.revives || 0) * 5 + (p.headshots || 0) * 2;
}

// Official-style BGMI/PUBG tie-breakers:
// total points → WWCD → placement points → total kills → better last-match placement
export function rankRows(rows) {
  rows.sort((a, b) =>
    b.totalPoints - a.totalPoints
    || b.wwcd - a.wwcd
    || b.placementPoints - a.placementPoints
    || b.totalKills - a.totalKills
    || (a.lastPlacement ?? 999) - (b.lastPlacement ?? 999)
    || String(a.teamName).localeCompare(String(b.teamName)));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

export async function recalcStandings(tournamentId, scope = 'overall') {
  const matchWhere = { tournamentId, deletedAt: null, status: { in: COUNTED_STATUSES } };
  if (scope.startsWith('round:')) matchWhere.roundId = Number(scope.split(':')[1]);

  const [stats, entries] = await Promise.all([
    prisma.teamStat.findMany({
      where: { match: matchWhere },
      include: { match: { select: { id: true } }, team: { select: { id: true, name: true } } },
    }),
    prisma.tournamentTeam.findMany({ where: { tournamentId }, include: { team: { select: { id: true, name: true } } } }),
  ]);

  const byTeam = new Map();
  const ensure = (teamId, teamName) => {
    if (!byTeam.has(teamId)) {
      byTeam.set(teamId, {
        teamId, teamName, matchesPlayed: 0, totalKills: 0, placementPoints: 0,
        killPoints: 0, totalPoints: 0, wwcd: 0, placementSum: 0, lastPlacement: null, lastMatchId: -1,
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
    if (s.match.id > row.lastMatchId) { row.lastMatchId = s.match.id; row.lastPlacement = s.placement; }
  }

  const rows = rankRows([...byTeam.values()].map((r) => ({
    ...r, avgPlacement: r.matchesPlayed ? +(r.placementSum / r.matchesPlayed).toFixed(2) : 0,
  })));

  await prisma.$transaction([
    prisma.overallStanding.deleteMany({ where: { tournamentId, scope } }),
    prisma.overallStanding.createMany({
      data: rows.map((r) => ({
        tournamentId, scope, teamId: r.teamId, matchesPlayed: r.matchesPlayed,
        totalKills: r.totalKills, placementPoints: r.placementPoints, killPoints: r.killPoints,
        totalPoints: r.totalPoints, wwcd: r.wwcd, avgPlacement: r.avgPlacement,
        lastPlacement: r.lastPlacement, rank: r.rank,
      })),
    }),
  ]);
  return rows;
}

export async function recalcTournament(tournamentId, roundIds = []) {
  await recalcStandings(tournamentId, 'overall');
  for (const rid of new Set(roundIds.filter(Boolean))) {
    await recalcStandings(tournamentId, `round:${rid}`);
  }
}

export async function getStandings(tournamentId, scope = 'overall') {
  let rows = await prisma.overallStanding.findMany({
    where: { tournamentId, scope },
    orderBy: { rank: 'asc' },
    include: { team: { select: { id: true, name: true, shortName: true, slug: true, logoUrl: true, country: true } } },
  });
  if (!rows.length) {
    await recalcStandings(tournamentId, scope);
    rows = await prisma.overallStanding.findMany({
      where: { tournamentId, scope }, orderBy: { rank: 'asc' },
      include: { team: { select: { id: true, name: true, shortName: true, slug: true, logoUrl: true, country: true } } },
    });
  }
  return rows;
}

export async function getTopFraggers(tournamentId, limit = 10, roundId = null) {
  const matchWhere = { tournamentId, deletedAt: null, status: { in: COUNTED_STATUSES } };
  if (roundId) matchWhere.roundId = Number(roundId);
  const grouped = await prisma.playerStat.groupBy({
    by: ['playerId'],
    where: { match: matchWhere },
    _sum: { kills: true, damage: true, assists: true, mvpScore: true, headshots: true },
    _count: { _all: true },
  });
  grouped.sort((a, b) => (b._sum.kills || 0) - (a._sum.kills || 0) || (b._sum.damage || 0) - (a._sum.damage || 0));
  const top = grouped.slice(0, limit);
  const players = await prisma.player.findMany({
    where: { id: { in: top.map((t) => t.playerId) } },
    include: { currentTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } } },
  });
  const pMap = new Map(players.map((p) => [p.id, p]));
  return top.map((t, i) => ({
    rank: i + 1,
    player: pMap.get(t.playerId) || { id: t.playerId, ign: 'Unknown' },
    matches: t._count._all,
    kills: t._sum.kills || 0,
    damage: Math.round(t._sum.damage || 0),
    assists: t._sum.assists || 0,
    headshots: t._sum.headshots || 0,
    avgKills: t._count._all ? +((t._sum.kills || 0) / t._count._all).toFixed(2) : 0,
    avgDamage: t._count._all ? Math.round((t._sum.damage || 0) / t._count._all) : 0,
    mvpScore: Math.round(t._sum.mvpScore || 0),
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
    where: { teamId: { in: [teamAId, teamBId] }, match: { tournamentId, deletedAt: null, status: { in: COUNTED_STATUSES } } },
    include: { match: { select: { id: true, matchNumber: true } } },
  });
  const byMatch = new Map();
  for (const s of stats) {
    if (!byMatch.has(s.matchId)) byMatch.set(s.matchId, {});
    byMatch.get(s.matchId)[s.teamId] = s;
  }
  let aWins = 0; let bWins = 0; const matches = [];
  for (const [matchId, pair] of byMatch) {
    const a = pair[teamAId]; const b = pair[teamBId];
    if (!a || !b) continue;
    if (a.placement < b.placement) aWins += 1; else if (b.placement < a.placement) bWins += 1;
    matches.push({ matchId, a: { placement: a.placement, kills: a.kills, points: a.totalPoints }, b: { placement: b.placement, kills: b.kills, points: b.totalPoints } });
  }
  return { teamAId, teamBId, aWins, bWins, matchesCompared: matches.length, matches };
}
