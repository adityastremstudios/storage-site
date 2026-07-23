// Analytics — materialised player/team aggregates, tournament + all-time
// records, and achievement unlocks.
//
// All three are computed from a single pass over the match data because they
// read the same rows. Everything respects `provided`: a stat the source never
// sent stays null instead of becoming a fake zero that would poison averages
// and hand out a "Highest Damage: 0" record.
import { prisma } from '../lib/prisma.js';
import { COUNTED_STATUSES, mvpScore } from './statsEngine.js';

const PLAYER_SUMS = ['kills', 'damage', 'assists', 'knocks', 'revives', 'headshots', 'deaths', 'survivalTime'];

const round2 = (v) => (v === null || v === undefined ? null : +Number(v).toFixed(2));

function makeAcc() {
  const a = { matches: 0, mvpCount: 0, wwcdCount: 0, placementSum: 0, best: null, worst: null, provided: new Set() };
  for (const k of PLAYER_SUMS) { a[k] = 0; a[`${k}_n`] = 0; }
  return a;
}

function addStat(acc, stat, keys) {
  acc.matches += 1;
  const provided = new Set(stat.provided || []);
  for (const k of keys) {
    const v = stat[k];
    if (v === null || v === undefined) continue;
    // Only count the value toward its average if the source really sent it.
    if (!provided.has(k) && v === 0) continue;
    acc[k] += Number(v);
    acc[`${k}_n`] += 1;
    acc.provided.add(k);
  }
}

const avgOf = (acc, key) => (acc[`${key}_n`] ? round2(acc[key] / acc[`${key}_n`]) : null);

/** Rebuild PlayerAggregate + TeamAggregate for one tournament and for careers. */
export async function recalcAggregates(tournamentId = null) {
  const matchWhere = { deletedAt: null, status: { in: COUNTED_STATUSES } };
  if (tournamentId) matchWhere.tournamentId = tournamentId;

  const [playerStats, teamStats] = await Promise.all([
    prisma.playerStat.findMany({
      where: { match: matchWhere },
      include: { match: { select: { id: true, tournamentId: true } } },
    }),
    prisma.teamStat.findMany({
      where: { match: matchWhere },
      include: { match: { select: { id: true, tournamentId: true } } },
    }),
  ]);

  // placement per (match, team) so player rows can inherit their team's result
  const placementByMatchTeam = new Map();
  for (const t of teamStats) placementByMatchTeam.set(`${t.matchId}:${t.teamId}`, t);

  // ---- players -------------------------------------------------------------
  const players = new Map(); // scopeKey|playerId -> acc
  const keyFor = (scope, id) => `${scope}||${id}`;

  for (const s of playerStats) {
    const scopes = ['career'];
    if (s.match.tournamentId) scopes.push(`tournament:${s.match.tournamentId}`);
    const teamRow = placementByMatchTeam.get(`${s.matchId}:${s.teamId}`);
    const score = s.mvpScore || mvpScore(s);

    for (const scope of scopes) {
      const k = keyFor(scope, s.playerId);
      if (!players.has(k)) players.set(k, { ...makeAcc(), scope, playerId: s.playerId, teamId: s.teamId, tournamentId: s.match.tournamentId });
      const acc = players.get(k);
      addStat(acc, s, PLAYER_SUMS);
      if (s.isMvp) acc.mvpCount += 1;
      if (teamRow) {
        acc.placementSum += teamRow.placement;
        if (teamRow.isWWCD) acc.wwcdCount += 1;
      }
      if (!acc.best || score > acc.best.score) acc.best = { matchId: s.matchId, score };
      if (!acc.worst || score < acc.worst.score) acc.worst = { matchId: s.matchId, score };
      acc.teamId = s.teamId ?? acc.teamId;
    }
  }

  // ---- teams ---------------------------------------------------------------
  const teams = new Map();
  for (const s of teamStats) {
    const scopes = ['career'];
    if (s.match.tournamentId) scopes.push(`tournament:${s.match.tournamentId}`);
    for (const scope of scopes) {
      const k = keyFor(scope, s.teamId);
      if (!teams.has(k)) {
        teams.set(k, {
          scope, teamId: s.teamId, tournamentId: s.match.tournamentId,
          matches: 0, points: 0, kills: 0, damage: 0, damage_n: 0, wwcd: 0,
          placementSum: 0, survival: 0, survival_n: 0, best: null, worst: null, provided: new Set(),
        });
      }
      const acc = teams.get(k);
      const provided = new Set(s.provided || []);
      acc.matches += 1;
      acc.points += s.totalPoints;
      acc.kills += s.kills;
      acc.placementSum += s.placement;
      if (s.isWWCD) acc.wwcd += 1;
      if (provided.has('damage')) { acc.damage += s.damage || 0; acc.damage_n += 1; acc.provided.add('damage'); }
      if (s.survivalTime !== null && s.survivalTime !== undefined) { acc.survival += s.survivalTime; acc.survival_n += 1; acc.provided.add('survivalTime'); }
      acc.provided.add('kills');
      if (!acc.best || s.totalPoints > acc.best.points) acc.best = { matchId: s.matchId, points: s.totalPoints };
      if (!acc.worst || s.totalPoints < acc.worst.points) acc.worst = { matchId: s.matchId, points: s.totalPoints };
    }
  }

  const playerRows = [...players.values()].map((a) => ({
    scope: a.scope,
    playerId: a.playerId,
    tournamentId: a.scope.startsWith('tournament:') ? a.tournamentId : null,
    teamId: a.teamId ?? null,
    matches: a.matches,
    kills: a.kills,
    damage: a.damage,
    assists: a.assists,
    knocks: a.knocks,
    revives: a.revives,
    headshots: a.headshots,
    deaths: a.deaths_n ? a.deaths : null,
    survivalTime: a.survivalTime_n ? a.survivalTime : null,
    mvpCount: a.mvpCount,
    wwcdCount: a.wwcdCount,
    avgKills: round2(a.kills / a.matches) ?? 0,
    avgDamage: avgOf(a, 'damage'),
    avgPlacement: round2(a.placementSum / a.matches) ?? 0,
    avgSurvival: avgOf(a, 'survivalTime'),
    bestMatchId: a.best?.matchId ?? null,
    worstMatchId: a.worst?.matchId ?? null,
    provided: [...a.provided],
    stale: false,
  }));

  const teamRows = [...teams.values()].map((a) => ({
    scope: a.scope,
    teamId: a.teamId,
    tournamentId: a.scope.startsWith('tournament:') ? a.tournamentId : null,
    matches: a.matches,
    points: a.points,
    kills: a.kills,
    damage: a.damage,
    wwcd: a.wwcd,
    avgPlacement: round2(a.placementSum / a.matches) ?? 0,
    avgKills: round2(a.kills / a.matches) ?? 0,
    avgDamage: a.damage_n ? round2(a.damage / a.damage_n) : null,
    avgSurvival: a.survival_n ? round2(a.survival / a.survival_n) : null,
    bestMatchId: a.best?.matchId ?? null,
    worstMatchId: a.worst?.matchId ?? null,
    provided: [...a.provided],
    stale: false,
  }));

  const scopes = [...new Set([...playerRows, ...teamRows].map((r) => r.scope))];
  await prisma.$transaction([
    prisma.playerAggregate.deleteMany({ where: { scope: { in: scopes } } }),
    prisma.teamAggregate.deleteMany({ where: { scope: { in: scopes } } }),
    prisma.playerAggregate.createMany({ data: playerRows }),
    prisma.teamAggregate.createMany({ data: teamRows }),
  ]);

  return { players: playerRows.length, teams: teamRows.length };
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

const RECORD_DEFS = [
  { key: 'highest_kill_match', label: 'Highest kill match', kind: 'match', field: 'totalKills' },
  { key: 'highest_team_kills', label: 'Highest team kills', kind: 'team', field: 'kills' },
  { key: 'highest_player_kills', label: 'Highest player kills', kind: 'player', field: 'kills' },
  { key: 'highest_player_damage', label: 'Highest player damage', kind: 'player', field: 'damage' },
  { key: 'most_wwcd', label: 'Most WWCD', kind: 'teamAgg', field: 'wwcd' },
  { key: 'longest_survival', label: 'Longest survival', kind: 'team', field: 'survivalTime' },
  { key: 'fastest_elimination', label: 'Fastest elimination', kind: 'team', field: 'survivalTime', min: true },
  { key: 'highest_placement_points', label: 'Highest placement points', kind: 'team', field: 'placementPoints' },
  { key: 'highest_kill_points', label: 'Highest kill points', kind: 'team', field: 'killPoints' },
];

export async function recalcRecords(tournamentId = null) {
  const scope = tournamentId ? `tournament:${tournamentId}` : 'alltime';
  const matchWhere = { deletedAt: null, status: { in: COUNTED_STATUSES } };
  if (tournamentId) matchWhere.tournamentId = tournamentId;

  const [teamStats, playerStats, teamAggs] = await Promise.all([
    prisma.teamStat.findMany({ where: { match: matchWhere } }),
    prisma.playerStat.findMany({ where: { match: matchWhere } }),
    prisma.teamAggregate.findMany({ where: { scope: tournamentId ? `tournament:${tournamentId}` : 'career' } }),
  ]);

  const byMatch = new Map();
  for (const s of teamStats) byMatch.set(s.matchId, (byMatch.get(s.matchId) || 0) + s.kills);

  const rows = [];
  const push = (def, value, ids, display) => {
    if (value === null || value === undefined) return;
    rows.push({
      scope, tournamentId: tournamentId ?? null, key: def.key, label: def.label,
      value: Number(value), displayValue: display ?? String(value), ...ids,
    });
  };

  for (const def of RECORD_DEFS) {
    if (def.kind === 'match') {
      let bestId = null; let bestVal = -1;
      for (const [matchId, kills] of byMatch) if (kills > bestVal) { bestVal = kills; bestId = matchId; }
      if (bestId) push(def, bestVal, { matchId: bestId });
    }
    if (def.kind === 'team' || def.kind === 'player') {
      const source = def.kind === 'team' ? teamStats : playerStats;
      const usable = source.filter((s) => {
        const v = s[def.field];
        if (v === null || v === undefined) return false;
        // Never award a record on a stat the source never supplied.
        if (['damage', 'survivalTime'].includes(def.field) && !(s.provided || []).includes(def.field)) return false;
        return true;
      });
      if (!usable.length) continue;
      const winner = usable.reduce((a, b) => {
        const av = Number(a[def.field]); const bv = Number(b[def.field]);
        return def.min ? (bv < av ? b : a) : (bv > av ? b : a);
      });
      push(def, winner[def.field], {
        matchId: winner.matchId,
        teamId: def.kind === 'team' ? winner.teamId : winner.teamId ?? null,
        playerId: def.kind === 'player' ? winner.playerId : null,
      });
    }
    if (def.kind === 'teamAgg') {
      if (!teamAggs.length) continue;
      const winner = teamAggs.reduce((a, b) => (b[def.field] > a[def.field] ? b : a));
      if (winner[def.field] > 0) push(def, winner[def.field], { teamId: winner.teamId });
    }
  }

  await prisma.$transaction([
    prisma.recordEntry.deleteMany({ where: { scope } }),
    prisma.recordEntry.createMany({ data: rows }),
  ]);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Achievements — rules live in the database so thresholds stay editable.
// rule: { basis: "match" | "career" | "tournament", stat, op, value }
// ---------------------------------------------------------------------------

function matches(rule, value) {
  if (value === null || value === undefined) return false;
  const v = Number(value);
  const target = Number(rule.value);
  switch (rule.op) {
    case '>=': return v >= target;
    case '>': return v > target;
    case '<=': return v <= target;
    case '<': return v < target;
    case '==': return v === target;
    default: return false;
  }
}

export async function recalcAchievements(tournamentId = null) {
  const defs = await prisma.achievementDef.findMany({ where: { isActive: true } });
  if (!defs.length) return 0;

  const matchWhere = { deletedAt: null, status: { in: COUNTED_STATUSES } };
  if (tournamentId) matchWhere.tournamentId = tournamentId;

  const [stats, aggs] = await Promise.all([
    prisma.playerStat.findMany({
      where: { match: matchWhere },
      include: { match: { select: { id: true, tournamentId: true } } },
    }),
    prisma.playerAggregate.findMany({
      where: tournamentId ? { scope: `tournament:${tournamentId}` } : { scope: 'career' },
    }),
  ]);

  const unlocks = new Map(); // playerId:achId:tid -> row

  for (const def of defs) {
    const rule = def.rule || {};
    if (rule.basis === 'match') {
      for (const s of stats) {
        if (!(s.provided || []).includes(rule.stat) && !['isMvp'].includes(rule.stat)) continue;
        const value = rule.stat === 'isMvp' ? (s.isMvp ? 1 : 0) : s[rule.stat];
        if (!matches(rule, value)) continue;
        const tid = s.match.tournamentId ?? null;
        const key = `${s.playerId}:${def.id}:${tid}`;
        const prev = unlocks.get(key);
        if (!prev || Number(value) > Number(prev.value)) {
          unlocks.set(key, {
            playerId: s.playerId, achievementId: def.id, tournamentId: tid,
            matchId: s.matchId, value: Number(value),
          });
        }
      }
    } else {
      for (const a of aggs) {
        const value = a[rule.stat];
        if (!matches(rule, value)) continue;
        const tid = a.tournamentId ?? null;
        unlocks.set(`${a.playerId}:${def.id}:${tid}`, {
          playerId: a.playerId, achievementId: def.id, tournamentId: tid,
          matchId: null, value: Number(value),
        });
      }
    }
  }

  const rows = [...unlocks.values()];
  await prisma.$transaction([
    prisma.playerAchievement.deleteMany(
      tournamentId ? { where: { tournamentId } } : { where: { tournamentId: null } },
    ),
    prisma.playerAchievement.createMany({ data: rows, skipDuplicates: true }),
  ]);
  return rows.length;
}
