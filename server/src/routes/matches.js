import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { crudRouter } from '../lib/crud.js';
import { httpError } from '../middleware/error.js';
import { applyStats } from '../services/importService.js';
import { publishMatch, bumpTournament } from '../services/publishService.js';
import { recalcTournament } from '../services/statsEngine.js';

const statsSchema = z.object({
  autoPublish: z.boolean().default(false),
  teams: z.array(z.object({
    team: z.union([z.string().min(1), z.number().int()]),
    placement: z.coerce.number().int().min(1),
    kills: z.coerce.number().int().min(0).optional(),
    damage: z.coerce.number().min(0).optional(),
    players: z.array(z.object({
      ign: z.string().min(1),
      kills: z.coerce.number().int().min(0).default(0),
      damage: z.coerce.number().min(0).default(0),
      assists: z.coerce.number().int().min(0).default(0),
      knocks: z.coerce.number().int().min(0).default(0),
      revives: z.coerce.number().int().min(0).default(0),
      headshots: z.coerce.number().int().min(0).default(0),
    })).default([]),
  })).min(2),
});

const include = {
  round: { select: { id: true, name: true, isLocked: true } },
  map: { select: { id: true, name: true } },
  winnerTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
  _count: { select: { teamStats: true, playerStats: true } },
};

export default crudRouter('match', {
  fields: ['roundId', 'mapId', 'matchNumber', 'scheduledAt', 'startedAt', 'endedAt', 'status'],
  searchFields: [],
  include,
  orderBy: [{ roundId: 'asc' }, { matchNumber: 'asc' }],
  writeRole: 'DATA_ENTRY',
  softDelete: true,
  transform: async (data, req, isCreate) => {
    if (data.roundId) {
      const round = await prisma.round.findUnique({ where: { id: Number(data.roundId) } });
      if (!round) throw httpError(400, 'Round not found');
      if (round.isLocked) throw httpError(423, 'Round is locked');
      data.tournamentId = round.tournamentId;
      if (isCreate && !data.matchNumber) {
        const max = await prisma.match.aggregate({ where: { roundId: round.id, deletedAt: null }, _max: { matchNumber: true } });
        data.matchNumber = (max._max.matchNumber ?? 0) + 1;
      }
    }
    return data;
  },
  extend: (r, { canWrite }) => {
    // Full match detail with team + player stats
    r.get('/:id(\\d+)/full', async (req, res, next) => {
      try {
        const match = await prisma.match.findUnique({
          where: { id: Number(req.params.id) },
          include: {
            ...include,
            tournament: { select: { id: true, name: true, slug: true } },
            teamStats: { orderBy: { placement: 'asc' }, include: { team: { select: { id: true, name: true, shortName: true, logoUrl: true } } } },
            playerStats: { orderBy: { kills: 'desc' }, include: { player: { select: { id: true, ign: true, photoUrl: true } }, team: { select: { id: true, name: true, shortName: true } } } },
          },
        });
        if (!match) return res.status(404).json({ error: 'Not found' });
        res.json(match);
      } catch (e) { next(e); }
    });

    // Manual stats entry (Data Entry role) — same pipeline as the API import
    r.post('/:id(\\d+)/stats', canWrite, async (req, res, next) => {
      try {
        const match = await prisma.match.findFirst({
          where: { id: Number(req.params.id), deletedAt: null },
          include: { tournament: { include: { pointRule: true } } },
        });
        if (!match) return res.status(404).json({ error: 'Match not found' });
        if (match.isLocked) return res.status(423).json({ error: 'Match is locked' });
        const payload = statsSchema.parse(req.body);
        const result = await applyStats(match, match.tournament, payload.teams, { publish: payload.autoPublish });
        res.json({ ok: true, ...result });
      } catch (e) { next(e); }
    });

    r.post('/:id(\\d+)/publish', canWrite, async (req, res, next) => {
      try {
        const m = await publishMatch(Number(req.params.id));
        if (!m) return res.status(404).json({ error: 'Match not found' });
        res.json(m);
      } catch (e) { next(e); }
    });

    const setLock = (locked) => async (req, res, next) => {
      try {
        const m = await prisma.match.update({
          where: { id: Number(req.params.id) },
          data: { isLocked: locked, ...(locked ? { status: 'LOCKED' } : {}) },
          include: { tournament: true },
        });
        await recalcTournament(m.tournamentId, [m.roundId]);
        await bumpTournament(m.tournament);
        res.json(m);
      } catch (e) { next(e); }
    };
    r.post('/:id(\\d+)/lock', canWrite, setLock(true));
    r.post('/:id(\\d+)/unlock', canWrite, setLock(false));
  },
});
