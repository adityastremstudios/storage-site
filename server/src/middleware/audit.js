import { prisma } from '../lib/prisma.js';

const strip = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  const { passwordHash, apiKey, ...rest } = obj; // never store secrets in audit
  return rest;
};

export async function logAudit(req, entity, entityId, action, before, after) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id ?? null,
        entity, entityId: Number(entityId) || 0, action,
        before: before ? strip(JSON.parse(JSON.stringify(before))) : undefined,
        after: after ? strip(JSON.parse(JSON.stringify(after))) : undefined,
      },
    });
  } catch (e) { console.warn('[audit] failed', e.message); }
}

export async function logActivity(userId, action, req, meta) {
  try {
    await prisma.activityLog.create({
      data: { userId, action, ip: req?.ip, meta },
    });
  } catch { /* non-fatal */ }
}
