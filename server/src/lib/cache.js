// Cache layer: Redis when REDIS_URL is set & reachable, otherwise in-memory.
// Invalidation uses a per-tournament version counter (no SCAN/DEL wildcards needed).
import Redis from 'ioredis';
import { config } from '../config.js';

let redis = null;
let redisOk = false;
const mem = new Map(); // key -> { value, exp }

if (config.redisUrl) {
  redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
  redis.connect().then(() => { redisOk = true; console.log('[cache] redis connected'); })
    .catch(() => { console.warn('[cache] redis unreachable, using in-memory cache'); });
  redis.on('error', () => { redisOk = false; });
  redis.on('ready', () => { redisOk = true; });
}

function memGet(key) {
  const hit = mem.get(key);
  if (!hit) return null;
  if (hit.exp && hit.exp < Date.now()) { mem.delete(key); return null; }
  return hit.value;
}
function memSet(key, value, ttlSec) {
  if (mem.size > 5000) mem.clear();
  mem.set(key, { value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
}

export async function cacheGet(key) {
  if (redisOk) {
    try { const v = await redis.get(key); return v ? JSON.parse(v) : null; } catch { /* fall through */ }
  }
  return memGet(key);
}

export async function cacheSet(key, value, ttlSec = config.cacheTtl) {
  const s = JSON.stringify(value);
  if (redisOk) { try { await redis.set(key, s, 'EX', ttlSec); return; } catch { /* fall through */ } }
  memSet(key, value, ttlSec);
}

export async function getVersion(slug) {
  const key = `v:${slug}`;
  if (redisOk) { try { return parseInt((await redis.get(key)) || '1', 10); } catch { /* noop */ } }
  return memGet(key) || 1;
}

export async function bumpVersion(slug) {
  const key = `v:${slug}`;
  if (redisOk) { try { return await redis.incr(key); } catch { /* noop */ } }
  const v = (memGet(key) || 1) + 1;
  memSet(key, v, 0);
  return v;
}

// Wrap a handler result in versioned cache
export async function cached(slug, path, ttl, fn) {
  const v = await getVersion(slug);
  const key = `pub:${slug}:${v}:${path}`;
  const hit = await cacheGet(key);
  if (hit) return hit;
  const data = await fn();
  await cacheSet(key, data, ttl);
  return data;
}

export function cacheStatus() {
  return { backend: redisOk ? 'redis' : 'memory' };
}
