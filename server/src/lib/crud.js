// Generic CRUD router factory: pagination, search, f_* filters, soft delete,
// restore, audit logging and role-based write protection — consistent everywhere.
import { Router } from 'express';
import { prisma } from './prisma.js';
import { authenticate, minRole } from '../middleware/auth.js';
import { logAudit } from '../middleware/audit.js';

const pass = (req, res, next) => next();
const DATE_FIELDS = new Set(['scheduledAt', 'startedAt', 'endedAt', 'startDate', 'endDate', 'joinedAt', 'leftAt']);

export function crudRouter(modelName, opts = {}) {
  const {
    fields = [],
    searchFields = ['name'],
    include,
    orderBy = { id: 'desc' },
    writeRole = 'ADMIN',
    readRole = null,
    softDelete = false,
    transform = null, // async (data, req, isCreate) => data
    extend = null,    // (router) => void — custom routes registered first
  } = opts;
  const model = prisma[modelName];
  const r = Router();
  r.use(authenticate);
  const canWrite = minRole(writeRole);
  const canRead = readRole ? minRole(readRole) : pass;

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
      for (const [k, raw] of Object.entries(req.query)) {
        if (!k.startsWith('f_')) continue;
        const key = k.slice(2);
        let v = raw;
        if (v === 'true') v = true;
        else if (v === 'false') v = false;
        else if (v !== '' && !Number.isNaN(Number(v))) v = Number(v);
        where[key] = v;
      }
      const [items, total] = await Promise.all([
        model.findMany({ where, include, orderBy, skip: (page - 1) * limit, take: limit }),
        model.count({ where }),
      ]);
      res.json({ items, total, page, limit });
    } catch (e) { next(e); }
  });

  r.get('/:id(\\d+)', canRead, async (req, res, next) => {
    try {
      const item = await model.findUnique({ where: { id: Number(req.params.id) }, include });
      if (!item) return res.status(404).json({ error: 'Not found' });
      res.json(item);
    } catch (e) { next(e); }
  });

  r.post('/', canWrite, async (req, res, next) => {
    try {
      let data = pick(req.body);
      if (transform) data = await transform(data, req, true);
      const created = await model.create({ data, include });
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
      const updated = await model.update({ where: { id }, data, include });
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
        return res.json({ ok: true, softDeleted: true });
      }
      await model.delete({ where: { id } });
      await logAudit(req, modelName, id, 'delete', before, null);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  if (softDelete) {
    r.post('/:id(\\d+)/restore', canWrite, async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const updated = await model.update({ where: { id }, data: { deletedAt: null } });
        await logAudit(req, modelName, id, 'restore', null, updated);
        res.json(updated);
      } catch (e) { next(e); }
    });
  }

  return r;
}
