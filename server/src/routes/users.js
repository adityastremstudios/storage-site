import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { authenticate, minRole } from '../middleware/auth.js';
import { logAudit } from '../middleware/audit.js';

const r = Router();
r.use(authenticate);

const publicUser = (u) => ({
  id: u.id, email: u.email, username: u.username, role: u.role,
  isActive: u.isActive, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
});

r.get('/', minRole('ADMIN'), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
    res.json({ items: users.map(publicUser), total: users.length });
  } catch (e) { next(e); }
});

r.post('/', minRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { email, username, password, role } = req.body || {};
    if (!email || !username || !password) return res.status(400).json({ error: 'email, username and password are required' });
    const created = await prisma.user.create({
      data: { email: String(email).toLowerCase(), username, role: role || 'READ_ONLY', passwordHash: await bcrypt.hash(password, 10) },
    });
    await logAudit(req, 'user', created.id, 'create', null, publicUser(created));
    res.status(201).json(publicUser(created));
  } catch (e) { next(e); }
});

r.patch('/:id(\\d+)', minRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = {};
    for (const f of ['email', 'username', 'role', 'isActive']) if (req.body[f] !== undefined) data[f] = req.body[f];
    if (req.body.password) {
      data.passwordHash = await bcrypt.hash(req.body.password, 10);
      data.tokenVersion = { increment: 1 };
    }
    if (id === req.user.id && data.isActive === false) return res.status(400).json({ error: 'You cannot deactivate your own account' });
    const updated = await prisma.user.update({ where: { id }, data });
    await logAudit(req, 'user', id, 'update', null, publicUser(updated));
    res.json(publicUser(updated));
  } catch (e) { next(e); }
});

r.delete('/:id(\\d+)', minRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    await prisma.user.delete({ where: { id } });
    await logAudit(req, 'user', id, 'delete', null, null);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

r.get('/activity', minRole('ADMIN'), async (req, res, next) => {
  try {
    const items = await prisma.activityLog.findMany({
      orderBy: { createdAt: 'desc' }, take: 200,
      include: { user: { select: { username: true, role: true } } },
    });
    res.json({ items });
  } catch (e) { next(e); }
});

export default r;
