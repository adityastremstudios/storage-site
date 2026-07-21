import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';

const r = Router();

r.get('/', authenticate, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ tournaments: [], teams: [], players: [], games: [], matches: [] });
    const c = { contains: q, mode: 'insensitive' };
    const [tournaments, teams, players, games] = await Promise.all([
      prisma.tournament.findMany({ where: { deletedAt: null, OR: [{ name: c }, { organizer: c }] }, take: 6, select: { id: true, name: true, slug: true, status: true } }),
      prisma.team.findMany({ where: { deletedAt: null, OR: [{ name: c }, { shortName: c }] }, take: 6, select: { id: true, name: true, shortName: true, logoUrl: true } }),
      prisma.player.findMany({ where: { deletedAt: null, OR: [{ ign: c }, { realName: c }] }, take: 6, select: { id: true, ign: true, realName: true, currentTeam: { select: { name: true } } } }),
      prisma.game.findMany({ where: { name: c }, take: 4, select: { id: true, name: true } }),
    ]);
    res.json({ tournaments, teams, players, games });
  } catch (e) { next(e); }
});

export default r;
