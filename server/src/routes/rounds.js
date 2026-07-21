import { prisma } from '../lib/prisma.js';
import { crudRouter } from '../lib/crud.js';
import { recalcStandings } from '../services/statsEngine.js';
import { bumpTournament } from '../services/publishService.js';

async function toggle(res, next, id, data) {
  try {
    const round = await prisma.round.update({ where: { id }, data, include: { tournament: true } });
    await bumpTournament(round.tournament);
    res.json(round);
  } catch (e) { next(e); }
}

export default crudRouter('round', {
  fields: ['tournamentId', 'name', 'order', 'startDate', 'isLocked', 'isPublished'],
  searchFields: ['name'],
  include: { _count: { select: { matches: true } } },
  orderBy: { order: 'asc' },
  writeRole: 'TOURNAMENT_MANAGER',
  extend: (r, { canWrite }) => {
    r.post('/:id(\\d+)/lock', canWrite, (req, res, next) => toggle(res, next, Number(req.params.id), { isLocked: true }));
    r.post('/:id(\\d+)/unlock', canWrite, (req, res, next) => toggle(res, next, Number(req.params.id), { isLocked: false }));
    r.post('/:id(\\d+)/publish', canWrite, async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const round = await prisma.round.update({ where: { id }, data: { isPublished: true }, include: { tournament: true } });
        await recalcStandings(round.tournamentId, `round:${id}`);
        await bumpTournament(round.tournament);
        res.json(round);
      } catch (e) { next(e); }
    });
  },
});
