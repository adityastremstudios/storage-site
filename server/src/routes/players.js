import { prisma } from '../lib/prisma.js';
import { crudRouter } from '../lib/crud.js';

export default crudRouter('player', {
  fields: ['ign', 'realName', 'photoUrl', 'country', 'role', 'currentTeamId'],
  searchFields: ['ign', 'realName'],
  include: { currentTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } } },
  orderBy: { ign: 'asc' },
  writeRole: 'TOURNAMENT_MANAGER',
  softDelete: true,
  transform: async (data, req, isCreate) => data,
  extend: (r, { canWrite }) => {
    // Transfer history: memberships + past teams, derived from team_players
    r.get('/:id(\\d+)/history', async (req, res, next) => {
      try {
        const memberships = await prisma.teamPlayer.findMany({
          where: { playerId: Number(req.params.id) },
          orderBy: { joinedAt: 'desc' },
          include: { team: { select: { id: true, name: true, shortName: true, logoUrl: true } } },
        });
        res.json({ items: memberships });
      } catch (e) { next(e); }
    });
    // Transfer a player to a new team (closes old membership, opens new one)
    r.post('/:id(\\d+)/transfer', canWrite, async (req, res, next) => {
      try {
        const playerId = Number(req.params.id);
        const { teamId } = req.body || {};
        if (!teamId) return res.status(400).json({ error: 'teamId is required' });
        await prisma.$transaction([
          prisma.teamPlayer.updateMany({ where: { playerId, isActive: true }, data: { isActive: false, leftAt: new Date() } }),
          prisma.teamPlayer.create({ data: { playerId, teamId: Number(teamId) } }),
          prisma.player.update({ where: { id: playerId }, data: { currentTeamId: Number(teamId) } }),
        ]);
        res.json({ ok: true });
      } catch (e) { next(e); }
    });
  },
});
