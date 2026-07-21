import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';

export const ROLE_LEVEL = {
  READ_ONLY: 0, CASTER: 1, OBSERVER: 1, DATA_ENTRY: 2,
  TOURNAMENT_MANAGER: 3, ADMIN: 4, SUPER_ADMIN: 5,
};

export function signAccess(user) {
  return jwt.sign({ sub: user.id, role: user.role, tv: user.tokenVersion }, config.jwtSecret, { expiresIn: config.accessTtl });
}
export function signRefresh(user) {
  return jwt.sign({ sub: user.id, tv: user.tokenVersion }, config.jwtRefreshSecret, { expiresIn: config.refreshTtl });
}

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not signed in' });
    let payload;
    try { payload = jwt.verify(token, config.jwtSecret); }
    catch { return res.status(401).json({ error: 'Session expired' }); }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || user.tokenVersion !== payload.tv) {
      return res.status(401).json({ error: 'Session invalid' });
    }
    req.user = user;
    next();
  } catch (e) { next(e); }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    if (req.user.role === 'SUPER_ADMIN' || roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'You do not have permission for this action' });
  };
}

export function minRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    if (ROLE_LEVEL[req.user.role] >= ROLE_LEVEL[role]) return next();
    return res.status(403).json({ error: 'You do not have permission for this action' });
  };
}

// API-key auth for machine-to-machine imports (game APIs / trackers)
export async function apiKeyAuth(req, res, next) {
  try {
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'Missing x-api-key header' });
    const connector = await prisma.apiConnector.findUnique({ where: { apiKey: String(key) } });
    if (!connector || !connector.isActive) return res.status(401).json({ error: 'Invalid API key' });
    req.connector = connector;
    next();
  } catch (e) { next(e); }
}
