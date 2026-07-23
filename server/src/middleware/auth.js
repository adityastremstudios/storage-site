import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { httpError } from './error.js';

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

// ---- API keys -------------------------------------------------------------
// Keys used to be stored and returned in plaintext, so any signed-in account
// (down to CASTER) could read every key from GET /api/connectors and push
// forged match data. Keys are now hashed; only the prefix is ever shown again.

export function generateApiKey() {
  const secret = `uet_${crypto.randomBytes(24).toString('hex')}`;
  return { secret, hash: hashApiKey(secret), prefix: secret.slice(0, 12) };
}

export function hashApiKey(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

export async function apiKeyAuth(req, res, next) {
  try {
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'Missing x-api-key header' });
    const connector = await prisma.apiConnector.findUnique({ where: { apiKeyHash: hashApiKey(key) } });
    if (!connector || !connector.isActive) return res.status(401).json({ error: 'Invalid API key' });
    req.connector = connector;
    next();
  } catch (e) { next(e); }
}

// A connector with a non-empty tournamentIds list may only write to those
// tournaments. Empty list = unrestricted (previous behaviour, so existing
// connectors keep working after the migration).
export function assertConnectorScope(connector, tournamentId) {
  if (!connector) return;
  const allowed = connector.tournamentIds || [];
  if (!allowed.length) return;
  if (!allowed.includes(Number(tournamentId))) {
    throw httpError(403, 'This API key is not allowed to import into that tournament');
  }
}
