// Public read-only API (Phase 12) — powers the website + overlays. Versioned cache.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { cached } from '../lib/cache.js';
import { getStandings, getTopFraggers, getTournamentMvp, getHeadToHead, COUNTED_STATUSES } from '../services/statsEngine.js';

const r = Router();
const teamSel = { select: { id: true, name: true, shortName: true, slug: true, logoUrl: true, country: true } };

async function findTournament(slug) {
  return prisma.tournament.findFirst({
    where: { slug, deletedAt: null },
    include: { game: { select: { id: true, name: true, shortName: true, logoUrl: true } }, sponsors: { orderBy: { order: 'asc' } } },
  });
}

r.get('/tournaments', async (req, res, next) => {
  try {
    const items = await prisma.tournament.findMany({
      where: { deletedAt: null, isArchived: req.query.archived === '1' ? true : false },
      orderBy: { id: 'desc' },
      include: { game: { select: { name: true, shortName: true, logoUrl: true } }, _count: { select: { matches: true, entries: true } } },
    });
    res.json({ items });
  } catch (e) { next(e); }
});

r.use('/t/:slug', async (req, res, next) => {
  try {
    const t = await findTournament(req.params.slug);
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    req.tournament = t;
    next();
  } catch (e) { next(e); }
});

r.get('/t/:slug', async (req, res, next) => {
  try {
    const t = req.tournament;
    const data = await cached(t.slug, 'meta', 60, async () => {
      const rounds = await prisma.round.findMany({ where: { tournamentId: t.id }, orderBy: { order: 'asc' }, include: { _count: { select: { matches: true } } } });
      return { ...t, rounds };
    });
    res.json(data);
  } catch (e) { next(e); }
});

r.get('/t/:slug/overall', async (req, res, next) => {
  try {
    const scope = req.query.round ? `round:${req.query.round}` : 'overall';
    const items = await cached(req.tournament.slug, `overall:${scope}`, 60, () => getStandings(req.tournament.id, scope));
    res.json({ tournament: { name: req.tournament.name, slug: req.tournament.slug, logoUrl: req.tournament.logoUrl }, scope, items });
  } catch (e) { next(e); }
});

r.get('/t/:slug/topfraggers', async (req, res, next) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 10);
    const roundId = req.query.round || null;
    const items = await cached(req.tournament.slug, `fraggers:${limit}:${roundId || 'all'}`, 60, () => getTopFraggers(req.tournament.id, limit, roundId));
    res.json({ tournament: { name: req.tournament.name, logoUrl: req.tournament.logoUrl }, items });
  } catch (e) { next(e); }
});

r.get('/t/:slug/mvp', async (req, res, next) => {
  try {
    const items = await cached(req.tournament.slug, 'mvp', 60, () => getTournamentMvp(req.tournament.id, 5));
    res.json({ items });
  } catch (e) { next(e); }
});

r.get('/t/:slug/matches', async (req, res, next) => {
  try {
    const roundId = req.query.round ? Number(req.query.round) : null;
    const items = await cached(req.tournament.slug, `matches:${roundId || 'all'}`, 60, () => prisma.match.findMany({
      where: { tournamentId: req.tournament.id, deletedAt: null, status: { in: COUNTED_STATUSES }, ...(roundId ? { roundId } : {}) },
      orderBy: [{ roundId: 'asc' }, { matchNumber: 'asc' }],
      include: { round: { select: { id: true, name: true } }, map: { select: { name: true } }, winnerTeam: teamSel },
    }));
    res.json({ items });
  } catch (e) { next(e); }
});

r.get('/t/:slug/matches/:id(\\d+)', async (req, res, next) => {
  try {
    const data = await cached(req.tournament.slug, `match:${req.params.id}`, 60, () => prisma.match.findFirst({
      where: { id: Number(req.params.id), tournamentId: req.tournament.id, deletedAt: null },
      include: {
        round: { select: { name: true } }, map: { select: { name: true } }, winnerTeam: teamSel,
        teamStats: { orderBy: { placement: 'asc' }, include: { team: teamSel } },
        playerStats: { orderBy: { kills: 'desc' }, include: { player: { select: { ign: true, photoUrl: true } }, team: { select: { shortName: true, name: true } } } },
      },
    }));
    if (!data) return res.status(404).json({ error: 'Match not found' });
    res.json(data);
  } catch (e) { next(e); }
});

r.get('/t/:slug/teams', async (req, res, next) => {
  try {
    const items = await cached(req.tournament.slug, 'teams', 120, () => prisma.tournamentTeam.findMany({
      where: { tournamentId: req.tournament.id },
      include: { team: { include: { currentPlayers: { where: { deletedAt: null }, select: { id: true, ign: true, role: true, photoUrl: true, country: true } } } } },
      orderBy: { id: 'asc' },
    }));
    res.json({ items });
  } catch (e) { next(e); }
});

r.get('/t/:slug/players', async (req, res, next) => {
  try {
    const items = await cached(req.tournament.slug, 'players', 120, async () => {
      const entries = await prisma.tournamentTeam.findMany({ where: { tournamentId: req.tournament.id }, select: { teamId: true } });
      return prisma.player.findMany({
        where: { deletedAt: null, currentTeamId: { in: entries.map((e) => e.teamId) } },
        orderBy: { ign: 'asc' },
        include: { currentTeam: { select: { name: true, shortName: true, logoUrl: true } } },
      });
    });
    res.json({ items });
  } catch (e) { next(e); }
});

// Live / current match for casters + overlays
r.get('/t/:slug/live', async (req, res, next) => {
  try {
    const data = await cached(req.tournament.slug, 'live', 15, async () => {
      const live = await prisma.match.findFirst({
        where: { tournamentId: req.tournament.id, deletedAt: null, status: 'LIVE' },
        orderBy: { id: 'desc' },
        include: { round: { select: { name: true } }, map: { select: { name: true } } },
      });
      if (live) return { state: 'live', match: live };
      const latest = await prisma.match.findFirst({
        where: { tournamentId: req.tournament.id, deletedAt: null, status: { in: COUNTED_STATUSES } },
        orderBy: { id: 'desc' },
        include: { round: { select: { name: true } }, map: { select: { name: true } }, winnerTeam: teamSel, teamStats: { orderBy: { placement: 'asc' }, take: 3, include: { team: teamSel } } },
      });
      return { state: latest ? 'last-result' : 'idle', match: latest };
    });
    res.json(data);
  } catch (e) { next(e); }
});

r.get('/t/:slug/schedule', async (req, res, next) => {
  try {
    const items = await cached(req.tournament.slug, 'schedule', 60, () => prisma.match.findMany({
      where: { tournamentId: req.tournament.id, deletedAt: null, status: { in: ['DRAFT', 'SCHEDULED'] } },
      orderBy: [{ scheduledAt: 'asc' }, { matchNumber: 'asc' }],
      include: { round: { select: { name: true } }, map: { select: { name: true } } },
    }));
    res.json({ items });
  } catch (e) { next(e); }
});

r.get('/t/:slug/h2h', async (req, res, next) => {
  try {
    const a = Number(req.query.a); const b = Number(req.query.b);
    if (!a || !b) return res.status(400).json({ error: 'Query params a & b (team ids) are required' });
    res.json(await getHeadToHead(req.tournament.id, a, b));
  } catch (e) { next(e); }
});

export default r;
