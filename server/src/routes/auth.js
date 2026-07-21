import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { authenticate, signAccess, signRefresh } from '../middleware/auth.js';
import { logActivity } from '../middleware/audit.js';

const r = Router();

// tiny in-memory rate limiter for login: 10 attempts / 5 min per IP
const attempts = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 5 * 60 * 1000);
  list.push(now);
  attempts.set(ip, list);
  if (attempts.size > 5000) attempts.clear();
  return list.length > 10;
}

const publicUser = (u) => ({
  id: u.id, email: u.email, username: u.username, role: u.role,
  isActive: u.isActive, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
});

r.post('/login', async (req, res, next) => {
  try {
    if (limited(req.ip)) return res.status(429).json({ error: 'Too many attempts — wait a few minutes and try again' });
    const { emailOrUsername, password } = req.body || {};
    if (!emailOrUsername || !password) return res.status(400).json({ error: 'Email/username and password are required' });
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: String(emailOrUsername).toLowerCase() }, { username: emailOrUsername }] },
    });
    if (!user || !user.isActive) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await logActivity(user.id, 'login', req);
    res.json({ user: publicUser(user), accessToken: signAccess(user), refreshToken: signRefresh(user) });
  } catch (e) { next(e); }
});

r.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
    let payload;
    try { payload = jwt.verify(refreshToken, config.jwtRefreshSecret); }
    catch { return res.status(401).json({ error: 'Session expired — sign in again' }); }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || user.tokenVersion !== payload.tv) return res.status(401).json({ error: 'Session invalid' });
    res.json({ user: publicUser(user), accessToken: signAccess(user), refreshToken: signRefresh(user) });
  } catch (e) { next(e); }
});

r.get('/me', authenticate, (req, res) => res.json(publicUser(req.user)));

r.post('/logout', authenticate, async (req, res, next) => {
  try { await logActivity(req.user.id, 'logout', req); res.json({ ok: true }); } catch (e) { next(e); }
});

r.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const ok = await bcrypt.compare(oldPassword, req.user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10), tokenVersion: { increment: 1 } },
    });
    await logActivity(req.user.id, 'change-password', req);
    res.json({ ok: true, message: 'Password changed — sign in again' });
  } catch (e) { next(e); }
});

export default r;
