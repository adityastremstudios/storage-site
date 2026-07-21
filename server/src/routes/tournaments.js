import { prisma } from '../lib/prisma.js';
import { crudRouter } from '../lib/crud.js';
import { uniqueSlug } from '../utils/slug.js';
import { getStandings, recalcTournament } from '../services/statsEngine.js';
import { bumpTournament } from '../services/publishService.js';
import { logAudit } from '../middleware/audit.js';

const include = {
  game: { select: { id: true, name: true, shortName: true, logoUrl: true } },
  pointRule: true,
  _count: { select: { rounds: true, matches: true, entries: true } },
};

export default crudRouter('tournament', {
  fields: ['name', 'gameId', 'logoUrl', 'bannerUrl', 'organizer', 'country', 'timezone', 'status', 'pointRuleId', 'pointsOverride', 'prizePool', 'startDate', 'endDate', 'isArchived'],
  searchFields: ['name', 'organizer'],
  include,
  writeRole: 'TOURNAMENT_MANAGER',
  softDelete: true,
  transform: async (data, req, isCreate) => {
    if (isCreate) {
      data.slug = await uniqueSlug(prisma.tournament, data.name);
      data.createdById = req.user.id;
    }
    return data;
  },
  extend: (r, { canWrite }) => {
    // Registered teams
    r.get('/:id(\\d+)/teams', async (req, res, next) => {
      try {
        const items = await prisma.tournamentTeam.findMany({
          where: { tournamentId: Number(req.params.id) },
          include: { team: { include: { currentPlayers: { where: { deletedAt: null }, select: { id: true, ign: true } } } } },
          orderBy: { id: 'asc' },
        });
        res.json({ items });
      } catch (e) { next(e); }
    });
    r.post('/:id(\\d+)/teams', canWrite, async (req, res, next) => {
      try {
        const tournamentId = Number(req.params.id);
        const ids = Array.isArray(req.body.teamIds) ? req.body.teamIds : [req.body.teamId];
        const created = [];
        for (const teamId of ids.filter(Boolean)) {
          created.push(await prisma.tournamentTeam.upsert({
            where: { tournamentId_teamId: { tournamentId, teamId: Number(teamId) } },
            update: {}, create: { tournamentId, teamId: Number(teamId) },
          }));
        }
        res.status(201).json({ items: created });
      } catch (e) { next(e); }
    });
    r.delete('/:id(\\d+)/teams/:teamId(\\d+)', canWrite, async (req, res, next) => {
      try {
        await prisma.tournamentTeam.deleteMany({
          where: { tournamentId: Number(req.params.id), teamId: Number(req.params.teamId) },
        });
        res.json({ ok: true });
      } catch (e) { next(e); }
    });

    // Standings (?round=ID for per-round, ?recalc=1 to force)
    r.get('/:id(\\d+)/standings', async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const scope = req.query.round ? `round:${req.query.round}` : 'overall';
        if (req.query.recalc === '1') {
          const t = await prisma.tournament.findUnique({ where: { id } });
          const rounds = await prisma.round.findMany({ where: { tournamentId: id }, select: { id: true } });
          await recalcTournament(id, rounds.map((x) => x.id));
          if (t) await bumpTournament(t);
        }
        res.json({ items: await getStandings(id, scope) });
      } catch (e) { next(e); }
    });

    // Clone tournament (rounds + registered teams, no matches)
    r.post('/:id(\\d+)/clone', canWrite, async (req, res, next) => {
      try {
        const src = await prisma.tournament.findUnique({
          where: { id: Number(req.params.id) },
          include: { rounds: true, entries: true },
        });
        if (!src) return res.status(404).json({ error: 'Not found' });
        const name = req.body.name || `${src.name} (Copy)`;
        const clone = await prisma.tournament.create({
          data: {
            name, slug: await uniqueSlug(prisma.tournament, name),
            gameId: src.gameId, logoUrl: src.logoUrl, bannerUrl: src.bannerUrl,
            organizer: src.organizer, country: src.country, timezone: src.timezone,
            pointRuleId: src.pointRuleId, pointsOverride: src.pointsOverride ?? undefined,
            prizePool: src.prizePool, status: 'DRAFT', createdById: req.user.id,
            rounds: { create: src.rounds.map((x) => ({ name: x.name, order: x.order })) },
            entries: { create: src.entries.map((x) => ({ teamId: x.teamId, seed: x.seed, groupName: x.groupName })) },
          },
          include,
        });
        await logAudit(req, 'tournament', clone.id, 'clone', { from: src.id }, clone);
        res.status(201).json(clone);
      } catch (e) { next(e); }
    });

    r.post('/:id(\\d+)/archive', canWrite, async (req, res, next) => {
      try {
        const t = await prisma.tournament.update({
          where: { id: Number(req.params.id) },
          data: { isArchived: true, status: 'ARCHIVED' }, include,
        });
        await bumpTournament(t);
        res.json(t);
      } catch (e) { next(e); }
    });

    // Ready-to-paste OBS browser source links
    r.get('/:id(\\d+)/overlay-links', async (req, res, next) => {
      try {
        const t = await prisma.tournament.findUnique({ where: { id: Number(req.params.id) } });
        if (!t) return res.status(404).json({ error: 'Not found' });
        const base = `${req.protocol}://${req.get('host')}`;
        const types = ['overall', 'topfraggers', 'matchresult', 'lowerthird'];
        res.json({
          items: types.map((type) => ({
            type,
            url: `${base}/overlay/${type}.html?t=${t.slug}`,
            note: 'Add as OBS Browser Source (1920x1080). Params: &bg=green|dark, &accent=%23HEX, &round=ID',
          })),
        });
      } catch (e) { next(e); }
    });
  },
});
