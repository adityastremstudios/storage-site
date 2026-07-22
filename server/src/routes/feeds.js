import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, minRole } from '../middleware/auth.js';
import { logAudit } from '../middleware/audit.js';
import { httpError } from '../middleware/error.js';
import { ADAPTERS } from '../services/feedAdapters.js';
import { previewFeed, runFeed, wakeFeed } from '../services/feedPoller.js';

const r = Router();
r.use(authenticate);

const feedSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  adapter: z.enum(['auto', ...Object.keys(ADAPTERS)]).default('auto'),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string()).nullable().optional(),
  tournamentId: z.coerce.number().int(),
  roundId: z.coerce.number().int().nullable().optional(),
  roundName: z.string().nullable().optional(),
  mapName: z.string().nullable().optional(),
  intervalSec: z.coerce.number().int().min(5).max(3600).default(20),
  isActive: z.boolean().default(false),
  autoPublish: z.boolean().default(true),
  importWhen: z.enum(['finished', 'always']).default('finished'),
  killField: z.enum(['auto', 'elim', 'knock', 'sum']).default('auto'),
  minTeams: z.coerce.number().int().min(2).max(64).default(2),
});

const include = {
  tournament: { select: { id: true, name: true, slug: true } },
  round: { select: { id: true, name: true } },
};

r.get('/adapters', (req, res) => res.json({
  items: Object.entries(ADAPTERS).map(([value, a]) => ({ value, label: a.label })),
}));

r.get('/', async (req, res, next) => {
  try {
    const where = req.query.tournamentId ? { tournamentId: Number(req.query.tournamentId) } : {};
    res.json({ items: await prisma.feedSource.findMany({ where, include, orderBy: { id: 'desc' } }) });
  } catch (e) { next(e); }
});

r.get('/:id', async (req, res, next) => {
  try {
    const feed = await prisma.feedSource.findUnique({ where: { id: Number(req.params.id) }, include });
    if (!feed) throw httpError(404, 'Feed not found');
    res.json(feed);
  } catch (e) { next(e); }
});

r.get('/:id/logs', async (req, res, next) => {
  try {
    res.json({
      items: await prisma.feedLog.findMany({
        where: { feedId: Number(req.params.id) }, orderBy: { createdAt: 'desc' }, take: 50,
      }),
    });
  } catch (e) { next(e); }
});

// Dry run: fetch the URL, map it, show exactly what would be imported. Nothing is saved.
r.post('/test', minRole('DATA_ENTRY'), async (req, res, next) => {
  try {
    const body = z.object({
      url: z.string().url(),
      adapter: z.string().default('auto'),
      killField: z.string().default('auto'),
      method: z.enum(['GET', 'POST']).default('GET'),
      headers: z.record(z.string()).nullable().optional(),
    }).parse(req.body);
    res.json(await previewFeed(body));
  } catch (e) { next(e); }
});

r.post('/', minRole('TOURNAMENT_MANAGER'), async (req, res, next) => {
  try {
    const data = feedSchema.parse(req.body);
    const feed = await prisma.feedSource.create({ data, include });
    await logAudit(req, 'FeedSource', feed.id, 'create', null, feed);
    res.status(201).json(feed);
  } catch (e) { next(e); }
});

r.patch('/:id', minRole('TOURNAMENT_MANAGER'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const before = await prisma.feedSource.findUnique({ where: { id } });
    if (!before) throw httpError(404, 'Feed not found');
    const data = feedSchema.partial().parse(req.body);
    // A changed target means the old dedupe hash no longer applies.
    if (data.url && data.url !== before.url) { data.lastHash = null; data.lastMatchKey = null; }
    const feed = await prisma.feedSource.update({ where: { id }, data, include });
    await logAudit(req, 'FeedSource', id, 'update', before, feed);
    wakeFeed(id);
    res.json(feed);
  } catch (e) { next(e); }
});

r.delete('/:id', minRole('TOURNAMENT_MANAGER'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const before = await prisma.feedSource.findUnique({ where: { id } });
    if (!before) throw httpError(404, 'Feed not found');
    await prisma.feedSource.delete({ where: { id } });
    await logAudit(req, 'FeedSource', id, 'delete', before, null);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Fetch + import immediately, ignoring the interval and the unchanged-payload guard.
r.post('/:id/run', minRole('DATA_ENTRY'), async (req, res, next) => {
  try {
    const result = await runFeed(Number(req.params.id), { force: true });
    wakeFeed(Number(req.params.id));
    res.json(result);
  } catch (e) { next(e); }
});

r.post('/:id/toggle', minRole('DATA_ENTRY'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const feed = await prisma.feedSource.findUnique({ where: { id } });
    if (!feed) throw httpError(404, 'Feed not found');
    const updated = await prisma.feedSource.update({ where: { id }, data: { isActive: !feed.isActive }, include });
    await logAudit(req, 'FeedSource', id, updated.isActive ? 'feed:start' : 'feed:stop', feed, updated);
    wakeFeed(id);
    res.json(updated);
  } catch (e) { next(e); }
});

export default r;
