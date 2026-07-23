// Generic CRUD router factory: pagination, search, f_* filters, soft delete,
// restore, audit logging and role-based write protection — consistent everywhere.
import { Router } from 'express';
import { prisma } from './prisma.js';
import { authenticate, minRole } from '../middleware/auth.js';
import { logAudit } from '../middleware/audit.js';

const pass = (req, res, next) => next();
const DATE_FIELDS = new Set(['scheduledAt', 'startedAt', 'endedAt', 'startDate', 'endDate', 'joinedAt', 'leftAt']);

// f_* used to be written straight into Prisma's `where`, so any caller could
// filter on arbitrary columns and — worse — send f_deletedAt to bypass the
// soft-delete filter on every model. Filters are now allowlisted.
const COMMON_FILTERS = new Set([
  'id', 'tournamentId', 'roundId', 'matchId', 'teamId', 'playerId', 'gameId',
  'organizationId', 'currentTeamId', 'status', 'isActive', 'isLocked',
  'isArchived', 'isPublished', 'isDefault', 'role', 'scope', 'type', 'stage',
  'groupName', 'mapId', 'winnerTeamId', 'matchNumber', 'order', 'source',
]);
const NEVER_FILTERABLE = new Set(['deletedAt', 'passwordHash', 'apiKey', 'apiKeyHash', 'tokenVersion']);

export function crudRouter(modelName, opts = {}) {
  const {
    fields = [],
    searchFields = ['name'],
    include,
    select,
    orderBy = { id: 'desc' },
    writeRole = 'ADMIN',
    readRole = null,
    softDelete = false,
    filterFields = null, // explicit allowlist; defaults to fields + COMMON_FILTERS
    transform = null,    // async (data, req, isCreate) => data
    extend = null,       // (router) => void — custom routes registered first
  } = opts;
  const model = prisma[modelName];
  const r = Router();
  r.use(authenticate);
  const canWrite = minRole(writeRole);
  const canRead = readRole ? minRole(readRole) : pass;
  const shape = select ? { select } : { include };

  const allowedFilters = new Set(
    filterFields || [...fields, ...COMMON_FILTERS],
  );
  for (const blocked of NEVER_FILTERABLE) allowedFilters.delete(blocked);

  if (extend) extend(r, { model, canWrite, canRead });

  const pick = (body) => {
    const out = {};
    for (const f of fields) {
      if (body[f] === undefined) continue;
      let v = body[f];
      if (DATE_FIELDS.has(f) && v) v = new Date(v);
      if (v === '') v = null;
      out[f] = v;
    }
    return out;
  };

  r.get('/', canRead, async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(500, parseInt(req.query.limit, 10) || 100);
      const where = {};
      if (softDelete && req.query.deleted !== '1') where.deletedAt = null;
      if (softDelete && req.query.deleted === '1') where.deletedAt = { not: null };
      if (req.query.q && searchFields.length) {
        where.OR = searchFields.map((f) => ({ [f]: { contains: req.query.q, mode: 'insensitive' } }));
      }
      const rejected = [];
      for (const [k, raw] of Object.entries(req.query)) {
        if (!k.startsWith('f_')) continue;
        const key = k.slice(2);
        if (!allowedFilters.has(key)) { rejected.push(key); continue; }
        let v = raw;
        if (v === 'true') v = true;
        else if (v === 'false') v = false;
        else if (v !== '' && !Number.isNaN(Number(v))) v = Number(v);
        where[key] = v;
      }
      if (rejected.length) {
        return res.status(400).json({ error: `Cannot filter on: ${rejected.join(', ')}` });
      }
      const [items, total] = await Promise.all([
        model.findMany({ where, ...shape, orderBy, skip: (page - 1) * limit, take: limit }),
        model.count({ where }),
      ]);
      res.json({ items, total, page, limit });
    } catch (e) { next(e); }
  });

  r.get('/:id(\\d+)', canRead, async (req, res, next) => {
    try {
      const item = await model.findUnique({ where: { id: Number(req.params.id) }, ...shape });
      if (!item) return res.status(404).json({ error: 'Not found' });
      res.json(item);
    } catch (e) { next(e); }
  });

  r.post('/', canWrite, async (req, res, next) => {
    try {
      let data = pick(req.body);
      if (transform) data = await transform(data, req, true);
      const created = await model.create({ data, ...shape });
      await logAudit(req, modelName, created.id, 'create', null, created);
      res.status(201).json(created);
    } catch (e) { next(e); }
  });

  r.patch('/:id(\\d+)', canWrite, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const before = await model.findUnique({ where: { id } });
      if (!before) return res.status(404).json({ error: 'Not found' });
      let data = pick(req.body);
      if (transform) data = await transform(data, req, false);
      const updated = await model.update({ where: { id }, data, ...shape });
      await logAudit(req, modelName, id, 'update', before, updated);
      res.json(updated);
    } catch (e) { next(e); }
  });

  r.delete('/:id(\\d+)', canWrite, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const before = await model.findUnique({ where: { id } });
      if (!before) return res.status(404).json({ error: 'Not found' });
      if (softDelete) {
        const updated = await model.update({ where: { id }, data: { deletedAt: new Date() } });
        await logAudit(req, modelName, id, 'soft-delete', before, updated);
        if (opts.afterWrite) await opts.afterWrite('delete', before, req);
        return res.json({ ok: true, softDeleted: true });
      }
      await model.delete({ where: { id } });
      await logAudit(req, modelName, id, 'delete', before, null);
      if (opts.afterWrite) await opts.afterWrite('delete', before, req);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  if (softDelete) {
    r.post('/:id(\\d+)/restore', canWrite, async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const updated = await model.update({ where: { id }, data: { deletedAt: null } });
        await logAudit(req, modelName, id, 'restore', null, updated);
        if (opts.afterWrite) await opts.afterWrite('restore', updated, req);
        res.json(updated);
      } catch (e) { next(e); }
    });
  }

  return r;
}
