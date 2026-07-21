import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { cacheStatus } from '../lib/cache.js';

const r = Router();

r.get('/', authenticate, async (req, res, next) => {
  try {
    const [tournaments, teams, players, matches, users, live] = await Promise.all([
      prisma.tournament.count({ where: { deletedAt: null } }),
      prisma.team.count({ where: { deletedAt: null } }),
      prisma.player.count({ where: { deletedAt: null } }),
      prisma.match.count({ where: { deletedAt: null } }),
      prisma.user.count(),
      prisma.tournament.findMany({
        where: { deletedAt: null, status: 'LIVE' },
        select: { id: true, name: true, slug: true, logoUrl: true, game: { select: { name: true } } },
      }),
    ]);
    const recentMatches = await prisma.match.findMany({
      where: { deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 8,
      include: {
        tournament: { select: { name: true, slug: true } },
        round: { select: { name: true } },
        winnerTeam: { select: { name: true, shortName: true, logoUrl: true } },
      },
    });
    res.json({ counts: { tournaments, teams, players, matches, users }, live, recentMatches, cache: cacheStatus() });
  } catch (e) { next(e); }
});

export default r;
