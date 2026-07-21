import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, minRole } from '../middleware/auth.js';

const r = Router();
r.use(authenticate, minRole('ADMIN'));

r.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.entity) where.entity = String(req.query.entity);
    if (req.query.entityId) where.entityId = Number(req.query.entityId);
    const items = await prisma.auditLog.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 200,
      include: { user: { select: { username: true, role: true } } },
    });
    res.json({ items });
  } catch (e) { next(e); }
});

export default r;
