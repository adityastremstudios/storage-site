// Statistics Center — every page in the spec, served from materialised
// aggregates so a 60-match tournament does not re-scan every row per request.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, minRole } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { COUNTED_STATUSES, getTopFraggers, getStandings } from '../services/statsEngine.js';
import { runRecalc } from '../services/recalcService.js';

const r = Router();
r.use(authenticate);

const num = (v, d = null) => {
  if (v === undefined || v === null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const scopeOf = (tournamentId) => (tournamentId ? `tournament:${Number(tournamentId)}` : 'career');

// Shared filter parser — every stats page accepts the same query shape.
function parseFilters(q) {
  return {
    tournamentId: num(q.tournament),
    roundId: num(q.round),
    matchId: num(q.match),
    map: q.map || null,
    country: q.country || null,
    teamId: num(q.team),
    playerId: num(q.player),
    role: q.role || null,
    minKills: num(q.minKills),
    minDamage: num(q.minDamage),
    minMatches: num(q.minMatches),
    limit: Math.min(200, num(q.limit, 50)),
    page: Math.max(1, num(q.page, 1)),
    sort: q.sort || null,
  };
}

function matchWhereFrom(f) {
  const where = { deletedAt: null, status: { in: COUNTED_STATUSES } };
  if (f.tournamentId) where.tournamentId = f.tournamentId;
  if (f.roundId) where.roundId = f.roundId;
  if (f.matchId) where.id = f.matchId;
  if (f.map) where.map = { name: { equals: f.map, mode: 'insensitive' } };
  return where;
}

// ---------------------------------------------------------------------------
// Player statistics — list + profile + comparison
// ---------------------------------------------------------------------------

r.get('/players', async (req, res, next) => {
  try {
    const f = parseFilters(req.query);
    const where = { scope: scopeOf(f.tournamentId) };
    if (f.teamId) where.teamId = f.teamId;
    if (f.minMatches) where.matches = { gte: f.minMatches };
    if (f.minKills) where.kills = { gte: f.minKills };
    if (f.playerId) where.playerId = f.playerId;

    const sortable = {
      kills: { kills: 'desc' }, damage: { damage: 'desc' }, assists: { assists: 'desc' },
      knocks: { knocks: 'desc' }, headshots: { headshots: 'desc' }, revives: { revives: 'desc' },
      mvp: { mvpCount: 'desc' }, avgKills: { avgKills: 'desc' }, avgDamage: { avgDamage: 'desc' },
      matches: { matches: 'desc' }, avgPlacement: { avgPlacement: 'asc' },
    };
    const orderBy = sortable[f.sort] || { kills: 'desc' };

    const [items, total] = await Promise.all([
      prisma.playerAggregate.findMany({
        where, orderBy, skip: (f.page - 1) * f.limit, take: f.limit,
        include: {
          player: {
            select: {
              id: true, ign: true, realName: true, photoUrl: true, country: true, role: true,
              currentTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
            },
          },
        },
      }),
      prisma.playerAggregate.count({ where }),
    ]);

    const filtered = items.filter((x) => {
      if (f.country && x.player?.country !== f.country) return false;
      if (f.role && x.player?.role !== f.role) return false;
      if (f.minDamage && (x.damage ?? 0) < f.minDamage) return false;
      return true;
    });

    res.json({
      items: filtered.map((x, i) => ({ rank: (f.page - 1) * f.limit + i + 1, ...x })),
      total, page: f.page, limit: f.limit,
    });
  } catch (e) { next(e); }
});

r.get('/players/:id(\\d+)', async (req, res, next) => {
  try {
    const playerId = Number(req.params.id);
    const tournamentId = num(req.query.tournament);
    const scope = scopeOf(tournamentId);

    const player = await prisma.player.findFirst({
      where: { id: playerId, deletedAt: null },
      include: {
        currentTeam: { select: { id: true, name: true, shortName: true, logoUrl: true, country: true } },
        memberships: {
          orderBy: { joinedAt: 'desc' }, take: 10,
          include: { team: { select: { id: true, name: true, logoUrl: true } } },
        },
      },
    });
    if (!player) throw httpError(404, 'Player not found');

    const [agg, career, recent, achievements] = await Promise.all([
      prisma.playerAggregate.findUnique({ where: { scope_playerId: { scope, playerId } } }),
      tournamentId ? prisma.playerAggregate.findUnique({ where: { scope_playerId: { scope: 'career', playerId } } }) : null,
      prisma.playerStat.findMany({
        where: {
          playerId,
          match: { deletedAt: null, status: { in: COUNTED_STATUSES }, ...(tournamentId ? { tournamentId } : {}) },
        },
        orderBy: { matchId: 'desc' }, take: 10,
        include: {
          match: {
            select: {
              id: true, matchNumber: true, endedAt: true,
              map: { select: { name: true } },
              round: { select: { id: true, name: true } },
              tournament: { select: { id: true, name: true, slug: true } },
            },
          },
          team: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        },
      }),
      prisma.playerAchievement.findMany({
        where: { playerId, ...(tournamentId ? { tournamentId } : {}) },
        include: { achievement: true }, orderBy: { unlockedAt: 'desc' },
      }),
    ]);

    // Placement per recent match comes from the team row.
    const teamRows = await prisma.teamStat.findMany({
      where: { matchId: { in: recent.map((x) => x.matchId) }, teamId: { in: recent.map((x) => x.teamId).filter(Boolean) } },
      select: { matchId: true, teamId: true, placement: true, isWWCD: true, kills: true },
    });
    const placeMap = new Map(teamRows.map((t) => [`${t.matchId}:${t.teamId}`, t]));

    const [best, worst] = await Promise.all([
      agg?.bestMatchId ? matchBrief(agg.bestMatchId, playerId) : null,
      agg?.worstMatchId ? matchBrief(agg.worstMatchId, playerId) : null,
    ]);

    res.json({
      player,
      scope,
      stats: agg || emptyAgg(playerId),
      career: career || null,
      bestMatch: best,
      worstMatch: worst,
      achievements,
      recentMatches: recent.map((s) => {
        const t = placeMap.get(`${s.matchId}:${s.teamId}`);
        return {
          matchId: s.matchId,
          matchNumber: s.match.matchNumber,
          tournament: s.match.tournament,
          round: s.match.round,
          map: s.match.map?.name || null,
          playedAt: s.match.endedAt,
          team: s.team,
          placement: t?.placement ?? null,
          isWWCD: t?.isWWCD ?? false,
          kills: s.kills,
          damage: (s.provided || []).includes('damage') ? s.damage : null,
          assists: s.assists,
          knocks: (s.provided || []).includes('knocks') ? s.knocks : null,
          headshots: s.headshots,
          survivalTime: s.survivalTime,
          isMvp: s.isMvp,
          mvpScore: Math.round(s.mvpScore),
          contribution: t && t.kills ? +((s.kills / t.kills) * 100).toFixed(1) : null,
        };
      }),
    });
  } catch (e) { next(e); }
});

async function matchBrief(matchId, playerId) {
  const [stat, match] = await Promise.all([
    prisma.playerStat.findFirst({ where: { matchId, playerId } }),
    prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true, matchNumber: true, endedAt: true,
        map: { select: { name: true } }, round: { select: { name: true } },
        tournament: { select: { id: true, name: true } },
      },
    }),
  ]);
  if (!stat || !match) return null;
  return {
    matchId, matchNumber: match.matchNumber, map: match.map?.name || null,
    round: match.round?.name || null, tournament: match.tournament, playedAt: match.endedAt,
    kills: stat.kills, damage: (stat.provided || []).includes('damage') ? stat.damage : null,
    assists: stat.assists, mvpScore: Math.round(stat.mvpScore),
  };
}

const emptyAgg = (playerId) => ({
  playerId, matches: 0, kills: 0, damage: 0, assists: 0, knocks: 0, revives: 0, headshots: 0,
  mvpCount: 0, wwcdCount: 0, avgKills: 0, avgDamage: null, avgPlacement: 0, avgSurvival: null,
  survivalTime: null, provided: [],
});

r.get('/players/compare', async (req, res, next) => {
  try {
    const ids = String(req.query.ids || '').split(',').map((x) => Number(x.trim())).filter(Boolean);
    if (ids.length < 2) throw httpError(400, 'Pass at least two player ids: ?ids=1,2');
    if (ids.length > 4) throw httpError(400, 'Compare at most four players at once');
    const tournamentId = num(req.query.tournament);
    const scope = scopeOf(tournamentId);

    const [players, aggs, trends] = await Promise.all([
      prisma.player.findMany({
        where: { id: { in: ids } },
        include: { currentTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } } },
      }),
      prisma.playerAggregate.findMany({ where: { scope, playerId: { in: ids } } }),
      prisma.playerStat.findMany({
        where: {
          playerId: { in: ids },
          match: { deletedAt: null, status: { in: COUNTED_STATUSES }, ...(tournamentId ? { tournamentId } : {}) },
        },
        orderBy: { matchId: 'asc' },
        select: { playerId: true, matchId: true, kills: true, damage: true, mvpScore: true, provided: true, match: { select: { matchNumber: true } } },
      }),
    ]);

    const aggMap = new Map(aggs.map((a) => [a.playerId, a]));
    const trendMap = new Map(ids.map((id) => [id, []]));
    for (const t of trends) {
      trendMap.get(t.playerId)?.push({
        matchId: t.matchId, matchNumber: t.match.matchNumber, kills: t.kills,
        damage: (t.provided || []).includes('damage') ? t.damage : null,
        mvpScore: Math.round(t.mvpScore),
      });
    }

    const rows = ids.map((id) => {
      const p = players.find((x) => x.id === id);
      const a = aggMap.get(id) || emptyAgg(id);
      return { player: p || { id, ign: 'Unknown' }, stats: a, trend: trendMap.get(id) || [] };
    });

    // Per-metric winner so the UI can highlight without recomputing.
    const metrics = ['kills', 'damage', 'assists', 'knocks', 'headshots', 'revives', 'survivalTime',
      'avgKills', 'avgDamage', 'avgPlacement', 'avgSurvival', 'mvpCount', 'wwcdCount', 'matches'];
    const lowerIsBetter = new Set(['avgPlacement']);
    const winners = {};
    for (const m of metrics) {
      const vals = rows.map((r2) => ({ id: r2.player.id, v: r2.stats[m] })).filter((x) => x.v !== null && x.v !== undefined);
      if (!vals.length) { winners[m] = null; continue; }
      winners[m] = vals.reduce((a, b) => (lowerIsBetter.has(m) ? (b.v < a.v ? b : a) : (b.v > a.v ? b : a))).id;
    }

    res.json({ scope, players: rows, winners, metrics });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Team statistics
// ---------------------------------------------------------------------------

r.get('/teams', async (req, res, next) => {
  try {
    const f = parseFilters(req.query);
    const where = { scope: scopeOf(f.tournamentId) };
    if (f.minMatches) where.matches = { gte: f.minMatches };
    if (f.teamId) where.teamId = f.teamId;

    const sortable = {
      points: { points: 'desc' }, kills: { kills: 'desc' }, damage: { damage: 'desc' },
      wwcd: { wwcd: 'desc' }, avgPlacement: { avgPlacement: 'asc' }, matches: { matches: 'desc' },
    };
    const items = await prisma.teamAggregate.findMany({
      where, orderBy: sortable[f.sort] || { points: 'desc' }, take: f.limit, skip: (f.page - 1) * f.limit,
      include: { team: { select: { id: true, name: true, shortName: true, logoUrl: true, country: true, coach: true } } },
    });
    const total = await prisma.teamAggregate.count({ where });
    const filtered = f.country ? items.filter((x) => x.team?.country === f.country) : items;
    res.json({ items: filtered.map((x, i) => ({ rank: (f.page - 1) * f.limit + i + 1, ...x })), total, page: f.page, limit: f.limit });
  } catch (e) { next(e); }
});

r.get('/teams/:id(\\d+)', async (req, res, next) => {
  try {
    const teamId = Number(req.params.id);
    const tournamentId = num(req.query.tournament);
    const scope = scopeOf(tournamentId);

    const team = await prisma.team.findFirst({
      where: { id: teamId, deletedAt: null },
      include: {
        organization: { select: { id: true, name: true, logoUrl: true } },
        memberships: {
          where: { leftAt: null },
          include: { player: { select: { id: true, ign: true, realName: true, photoUrl: true, country: true, role: true } } },
        },
      },
    });
    if (!team) throw httpError(404, 'Team not found');

    const [agg, recent, roster] = await Promise.all([
      prisma.teamAggregate.findUnique({ where: { scope_teamId: { scope, teamId } } }),
      prisma.teamStat.findMany({
        where: {
          teamId,
          match: { deletedAt: null, status: { in: COUNTED_STATUSES }, ...(tournamentId ? { tournamentId } : {}) },
        },
        orderBy: { matchId: 'desc' }, take: 10,
        include: {
          match: {
            select: {
              id: true, matchNumber: true, endedAt: true,
              map: { select: { name: true } }, round: { select: { id: true, name: true } },
              tournament: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.playerAggregate.findMany({
        where: { scope, teamId },
        include: { player: { select: { id: true, ign: true, photoUrl: true, country: true, role: true } } },
        orderBy: { kills: 'desc' },
      }),
    ]);

    res.json({
      team,
      scope,
      stats: agg || { teamId, matches: 0, points: 0, kills: 0, damage: 0, wwcd: 0, avgPlacement: 0, avgKills: 0, avgDamage: null, provided: [] },
      roster,
      recentMatches: recent.map((s) => ({
        matchId: s.matchId, matchNumber: s.match.matchNumber, tournament: s.match.tournament,
        round: s.match.round, map: s.match.map?.name || null, playedAt: s.match.endedAt,
        placement: s.placement, kills: s.kills,
        damage: (s.provided || []).includes('damage') ? s.damage : null,
        points: s.totalPoints, isWWCD: s.isWWCD, penaltyPoints: s.penaltyPoints,
      })),
    });
  } catch (e) { next(e); }
});

r.get('/teams/compare', async (req, res, next) => {
  try {
    const ids = String(req.query.ids || '').split(',').map((x) => Number(x.trim())).filter(Boolean);
    if (ids.length < 2) throw httpError(400, 'Pass at least two team ids: ?ids=1,2');
    const tournamentId = num(req.query.tournament);
    const scope = scopeOf(tournamentId);

    const [teams, aggs, trend] = await Promise.all([
      prisma.team.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, shortName: true, logoUrl: true, country: true, coach: true } }),
      prisma.teamAggregate.findMany({ where: { scope, teamId: { in: ids } } }),
      prisma.teamStat.findMany({
        where: {
          teamId: { in: ids },
          match: { deletedAt: null, status: { in: COUNTED_STATUSES }, ...(tournamentId ? { tournamentId } : {}) },
        },
        orderBy: { matchId: 'asc' },
        select: { teamId: true, matchId: true, placement: true, kills: true, totalPoints: true, match: { select: { matchNumber: true } } },
      }),
    ]);

    const aggMap = new Map(aggs.map((a) => [a.teamId, a]));
    const trendMap = new Map(ids.map((id) => [id, []]));
    let running = new Map(ids.map((id) => [id, 0]));
    for (const t of trend) {
      running.set(t.teamId, (running.get(t.teamId) || 0) + t.totalPoints);
      trendMap.get(t.teamId)?.push({
        matchNumber: t.match.matchNumber, placement: t.placement, kills: t.kills,
        points: t.totalPoints, cumulative: running.get(t.teamId),
      });
    }

    res.json({
      scope,
      teams: ids.map((id) => ({
        team: teams.find((t) => t.id === id) || { id, name: 'Unknown' },
        stats: aggMap.get(id) || null,
        trend: trendMap.get(id) || [],
      })),
    });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Match statistics
// ---------------------------------------------------------------------------

r.get('/matches/:id(\\d+)', async (req, res, next) => {
  try {
    const matchId = Number(req.params.id);
    const match = await prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      include: {
        tournament: { select: { id: true, name: true, slug: true } },
        round: { select: { id: true, name: true } },
        map: { select: { id: true, name: true, imageUrl: true } },
        winnerTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
      },
    });
    if (!match) throw httpError(404, 'Match not found');

    const [teamStats, playerStats] = await Promise.all([
      prisma.teamStat.findMany({
        where: { matchId }, orderBy: { placement: 'asc' },
        include: { team: { select: { id: true, name: true, shortName: true, logoUrl: true, country: true } } },
      }),
      prisma.playerStat.findMany({
        where: { matchId },
        include: {
          player: { select: { id: true, ign: true, photoUrl: true, country: true, role: true } },
          team: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        },
      }),
    ]);

    const teamKills = new Map(teamStats.map((t) => [t.teamId, t.kills]));
    const has = (s, key) => (s.provided || []).includes(key);

    // Leaderboards. A board whose stat was never supplied comes back empty
    // rather than a table of zeroes.
    const board = (key, extra = {}) => {
      const rows = playerStats.filter((s) => has(s, key) && s[key] !== null);
      return rows
        .sort((a, b) => b[key] - a[key])
        .slice(0, extra.limit || 10)
        .map((s, i) => ({
          rank: i + 1, player: s.player, team: s.team, value: s[key],
          contribution: key === 'kills' && teamKills.get(s.teamId)
            ? +((s.kills / teamKills.get(s.teamId)) * 100).toFixed(1) : null,
        }));
    };

    const mvp = playerStats.reduce((a, b) => (!a || b.mvpScore > a.mvpScore ? b : a), null);

    res.json({
      match,
      teamRanking: teamStats.map((s) => ({
        placement: s.placement, team: s.team, kills: s.kills,
        damage: has(s, 'damage') ? s.damage : null,
        survivalTime: s.survivalTime,
        placementPoints: s.placementPoints, killPoints: s.killPoints,
        totalPoints: s.totalPoints, penaltyPoints: s.penaltyPoints,
        isWWCD: s.isWWCD, source: s.source,
      })),
      playerRanking: [...playerStats]
        .sort((a, b) => b.mvpScore - a.mvpScore)
        .map((s, i) => ({
          rank: i + 1, player: s.player, team: s.team, kills: s.kills,
          damage: has(s, 'damage') ? s.damage : null,
          assists: s.assists, knocks: has(s, 'knocks') ? s.knocks : null,
          headshots: s.headshots, revives: s.revives, survivalTime: s.survivalTime,
          mvpScore: Math.round(s.mvpScore), isMvp: s.isMvp, source: s.source,
          contribution: teamKills.get(s.teamId) ? +((s.kills / teamKills.get(s.teamId)) * 100).toFixed(1) : null,
        })),
      leaders: {
        topFraggers: board('kills'),
        topDamage: board('damage'),
        topAssists: board('assists'),
        topSurvival: board('survivalTime'),
        topHeadshots: board('headshots'),
        topRevives: board('revives'),
        topKnockdowns: board('knocks'),
      },
      bestTeam: teamStats[0]
        ? { team: teamStats[0].team, points: teamStats[0].totalPoints, kills: teamStats[0].kills }
        : null,
      mvp: mvp ? { player: mvp.player, team: mvp.team, mvpScore: Math.round(mvp.mvpScore), kills: mvp.kills } : null,
      killLeader: board('kills')[0] || null,
      damageLeader: board('damage')[0] || null,
      totals: {
        teams: teamStats.length,
        players: playerStats.length,
        kills: teamStats.reduce((s, t) => s + t.kills, 0),
        damage: teamStats.some((t) => has(t, 'damage'))
          ? Math.round(teamStats.reduce((s, t) => s + (has(t, 'damage') ? t.damage : 0), 0)) : null,
      },
    });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Round + tournament statistics
// ---------------------------------------------------------------------------

r.get('/rounds/:id(\\d+)', async (req, res, next) => {
  try {
    const roundId = Number(req.params.id);
    const round = await prisma.round.findUnique({
      where: { id: roundId },
      include: { tournament: { select: { id: true, name: true, slug: true } } },
    });
    if (!round) throw httpError(404, 'Round not found');

    const where = { deletedAt: null, roundId, status: { in: COUNTED_STATUSES } };
    const [matches, teamStats, topPlayers, standings] = await Promise.all([
      prisma.match.findMany({
        where, orderBy: { matchNumber: 'asc' },
        select: { id: true, matchNumber: true, endedAt: true, status: true, map: { select: { name: true } } },
      }),
      prisma.teamStat.findMany({
        where: { match: where },
        include: { team: { select: { id: true, name: true, shortName: true, logoUrl: true } } },
      }),
      getTopFraggers(round.tournamentId, 10, roundId),
      getStandings(round.tournamentId, `round:${roundId}`),
    ]);

    const byTeam = new Map();
    for (const s of teamStats) {
      if (!byTeam.has(s.teamId)) byTeam.set(s.teamId, { team: s.team, matches: 0, kills: 0, points: 0, placementSum: 0, wwcd: 0 });
      const a = byTeam.get(s.teamId);
      a.matches += 1; a.kills += s.kills; a.points += s.totalPoints;
      a.placementSum += s.placement; if (s.isWWCD) a.wwcd += 1;
    }
    const topTeams = [...byTeam.values()]
      .map((a) => ({ ...a, avgPlacement: +(a.placementSum / a.matches).toFixed(2), avgKills: +(a.kills / a.matches).toFixed(2) }))
      .sort((a, b) => b.points - a.points);

    const mvp = topPlayers[0] || null;
    res.json({
      round,
      matches,
      standings,
      topTeams,
      topPlayers,
      roundMvp: mvp,
      averages: {
        killsPerMatch: matches.length ? +(teamStats.reduce((s, t) => s + t.kills, 0) / matches.length).toFixed(2) : 0,
        placement: byTeam.size ? +([...byTeam.values()].reduce((s, a) => s + a.placementSum / a.matches, 0) / byTeam.size).toFixed(2) : 0,
      },
    });
  } catch (e) { next(e); }
});

r.get('/tournaments/:id(\\d+)', async (req, res, next) => {
  try {
    const tournamentId = Number(req.params.id);
    const tournament = await prisma.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      include: { game: { select: { id: true, name: true, format: true } }, pointRule: true },
    });
    if (!tournament) throw httpError(404, 'Tournament not found');

    const where = { tournamentId, deletedAt: null, status: { in: COUNTED_STATUSES } };
    const [matchCount, rounds, teamCount, playerCount, topPlayers, standings, records, teamStats] = await Promise.all([
      prisma.match.count({ where }),
      prisma.round.findMany({ where: { tournamentId }, orderBy: { order: 'asc' }, select: { id: true, name: true, stage: true, isPublished: true } }),
      prisma.tournamentTeam.count({ where: { tournamentId } }),
      prisma.playerAggregate.count({ where: { scope: `tournament:${tournamentId}` } }),
      getTopFraggers(tournamentId, 10),
      getStandings(tournamentId, 'overall'),
      prisma.recordEntry.findMany({
        where: { scope: `tournament:${tournamentId}` },
        include: {
          player: { select: { id: true, ign: true, photoUrl: true } },
          team: { select: { id: true, name: true, logoUrl: true } },
          match: { select: { id: true, matchNumber: true } },
        },
      }),
      prisma.teamStat.findMany({ where: { match: where }, select: { kills: true, damage: true, provided: true, placement: true } }),
    ]);

    const damageRows = teamStats.filter((t) => (t.provided || []).includes('damage'));
    res.json({
      tournament,
      summary: {
        matches: matchCount,
        rounds: rounds.length,
        teams: teamCount,
        players: playerCount,
        totalKills: teamStats.reduce((s, t) => s + t.kills, 0),
        totalDamage: damageRows.length ? Math.round(damageRows.reduce((s, t) => s + t.damage, 0)) : null,
        avgKillsPerMatch: matchCount ? +(teamStats.reduce((s, t) => s + t.kills, 0) / matchCount).toFixed(2) : 0,
      },
      rounds,
      standings,
      topPlayers,
      records,
    });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Records + achievements
// ---------------------------------------------------------------------------

r.get('/records', async (req, res, next) => {
  try {
    const tournamentId = num(req.query.tournament);
    const scope = tournamentId ? `tournament:${tournamentId}` : 'alltime';
    const items = await prisma.recordEntry.findMany({
      where: { scope },
      include: {
        player: { select: { id: true, ign: true, photoUrl: true, country: true } },
        team: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        match: { select: { id: true, matchNumber: true, round: { select: { name: true } } } },
      },
    });
    res.json({ scope, items });
  } catch (e) { next(e); }
});

r.get('/achievements', async (req, res, next) => {
  try {
    const tournamentId = num(req.query.tournament);
    const playerId = num(req.query.player);
    const where = {};
    if (tournamentId) where.tournamentId = tournamentId;
    if (playerId) where.playerId = playerId;
    const items = await prisma.playerAchievement.findMany({
      where, orderBy: { unlockedAt: 'desc' }, take: 200,
      include: {
        achievement: true,
        player: { select: { id: true, ign: true, photoUrl: true, currentTeam: { select: { name: true, logoUrl: true } } } },
      },
    });
    res.json({ items });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Caster panel — rule-based insight lines, no external service so it keeps
// working when the venue wifi does not.
// ---------------------------------------------------------------------------

r.get('/caster/:tournamentId(\\d+)', async (req, res, next) => {
  try {
    const tournamentId = Number(req.params.tournamentId);
    const teamId = num(req.query.team);
    const playerId = num(req.query.player);
    const scope = `tournament:${tournamentId}`;

    const [standings, topPlayers, records, recentMatches] = await Promise.all([
      getStandings(tournamentId, 'overall'),
      getTopFraggers(tournamentId, 5),
      prisma.recordEntry.findMany({
        where: { scope },
        include: { player: { select: { ign: true } }, team: { select: { name: true } } },
      }),
      prisma.match.findMany({
        where: { tournamentId, deletedAt: null, status: { in: COUNTED_STATUSES } },
        orderBy: { matchNumber: 'desc' }, take: 5,
        select: { id: true, matchNumber: true, map: { select: { name: true } } },
      }),
    ]);

    const insights = [];
    const push = (category, text) => insights.push({ category, text });

    if (standings.length) {
      const lead = standings[0];
      const second = standings[1];
      push('standings', `${lead.team.name} lead on ${Math.round(lead.totalPoints)} points from ${lead.matchesPlayed} matches.`);
      if (second) {
        const gap = Math.round(lead.totalPoints - second.totalPoints);
        push('standings', gap === 0
          ? `${lead.team.name} and ${second.team.name} are level on points — ${lead.tiebreakReason || 'split on tiebreak'}.`
          : `${second.team.name} sit ${gap} point${gap === 1 ? '' : 's'} back in second.`);
      }
      const mostWwcd = [...standings].sort((a, b) => b.wwcd - a.wwcd)[0];
      if (mostWwcd?.wwcd > 0) push('standings', `${mostWwcd.team.name} have the most chicken dinners with ${mostWwcd.wwcd}.`);
    }

    if (topPlayers.length) {
      const top = topPlayers[0];
      push('fragging', `${top.player.ign} tops the frag chart with ${top.kills} kills across ${top.matches} matches — ${top.avgKills} per game.`);
      if (top.avgDamage) push('fragging', `${top.player.ign} is averaging ${Math.round(top.avgDamage)} damage a match.`);
      const bestAvg = [...topPlayers].sort((a, b) => b.avgKills - a.avgKills)[0];
      if (bestAvg && bestAvg.player.id !== top.player.id) {
        push('fragging', `Best kills-per-match belongs to ${bestAvg.player.ign} at ${bestAvg.avgKills}.`);
      }
    }

    for (const rec of records) {
      const who = rec.player?.ign || rec.team?.name;
      if (who) push('record', `${rec.label}: ${who} with ${rec.displayValue || rec.value}.`);
    }

    // Recent form over the last five matches
    if (recentMatches.length) {
      const ids = recentMatches.map((m) => m.id);
      const recent = await prisma.teamStat.findMany({
        where: { matchId: { in: ids } },
        include: { team: { select: { id: true, name: true } } },
      });
      const form = new Map();
      for (const s of recent) {
        if (!form.has(s.teamId)) form.set(s.teamId, { team: s.team, points: 0, kills: 0, matches: 0 });
        const a = form.get(s.teamId);
        a.points += s.totalPoints; a.kills += s.kills; a.matches += 1;
      }
      const hot = [...form.values()].sort((a, b) => b.points - a.points)[0];
      if (hot) push('form', `Hottest form over the last ${recentMatches.length} matches: ${hot.team.name} with ${Math.round(hot.points)} points and ${hot.kills} kills.`);
    }

    if (teamId) {
      const agg = await prisma.teamAggregate.findUnique({
        where: { scope_teamId: { scope, teamId } },
        include: { team: { select: { name: true } } },
      });
      if (agg) {
        push('team', `${agg.team.name}: ${Math.round(agg.points)} points, ${agg.kills} kills, average placement ${agg.avgPlacement}.`);
        const roster = await prisma.playerAggregate.findMany({
          where: { scope, teamId }, orderBy: { kills: 'desc' }, take: 1,
          include: { player: { select: { ign: true } } },
        });
        if (roster[0] && agg.kills) {
          const share = ((roster[0].kills / agg.kills) * 100).toFixed(0);
          push('team', `${roster[0].player.ign} is carrying ${share}% of ${agg.team.name}'s kills.`);
        }
      }
    }

    if (playerId) {
      const agg = await prisma.playerAggregate.findUnique({
        where: { scope_playerId: { scope, playerId } },
        include: { player: { select: { ign: true } } },
      });
      if (agg) {
        push('player', `${agg.player.ign}: ${agg.kills} kills in ${agg.matches} matches, ${agg.avgKills} per game${agg.mvpCount ? `, ${agg.mvpCount} MVP${agg.mvpCount === 1 ? '' : 's'}` : ''}.`);
      }
    }

    res.json({ tournamentId, generatedAt: new Date().toISOString(), insights });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Recalculation triggers
// ---------------------------------------------------------------------------

r.post('/recalc', minRole('TOURNAMENT_MANAGER'), async (req, res, next) => {
  try {
    const { tournamentId, scope = 'all', roundId = null, matchId = null } = req.body || {};
    if (!tournamentId) throw httpError(400, 'tournamentId is required');
    const result = await runRecalc({
      tournamentId: Number(tournamentId), scope, roundId, matchId, actorId: req.user.id,
    });
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

r.get('/recalc/jobs', async (req, res, next) => {
  try {
    const tournamentId = num(req.query.tournament);
    const items = await prisma.recalcJob.findMany({
      where: tournamentId ? { tournamentId } : {},
      orderBy: { id: 'desc' }, take: 25,
      include: { requestedBy: { select: { id: true, username: true } } },
    });
    res.json({ items });
  } catch (e) { next(e); }
});

export default r;
