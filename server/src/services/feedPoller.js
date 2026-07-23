// Pull-mode ingestion: UETMS polls a remote JSON endpoint on a timer, maps it
// through an adapter and pushes it into the same import pipeline the push API
// uses.
//
// Main fix: when a feed sends no matchId, the old fallback key embedded the
// payload hash. In live mode the payload changes every poll, so every poll
// minted a new externalMatchId and created a brand new match. The feed now
// carries a stable sessionKey that only rolls over once a match finishes.
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { mapFeed } from './feedAdapters.js';
import { importMatch } from './importService.js';

const TICK_MS = 2000;
const MIN_INTERVAL = 5;
const state = new Map(); // feedId -> { nextAt, running }
let timer = null;

function hash(value) {
  return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

export async function fetchFeed(feed) {
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(feed.url, {
      method: feed.method || 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'UETMS-Feed/1.0', ...(feed.headers || {}) },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Endpoint returned ${res.status} ${res.statusText}`);
    // A broken endpoint returning an HTML error page should not be buffered
    // into memory unbounded.
    if (text.length > 8 * 1024 * 1024) throw new Error('Feed response larger than 8MB — refusing');
    try { return JSON.parse(text); }
    catch { throw new Error('Endpoint did not return valid JSON'); }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Endpoint timed out after 15s');
    if (e.cause?.message || e.cause?.code) throw new Error(`Cannot reach ${feed.url} — ${e.cause.message || e.cause.code}`);
    throw e;
  } finally {
    clearTimeout(abort);
  }
}

/** Fetch + map without touching the database — powers the "Test feed" button. */
export async function previewFeed({ url, adapter = 'auto', killField = 'auto', headers = null, method = 'GET' }) {
  const started = Date.now();
  const raw = await fetchFeed({ url, adapter, headers, method });
  const mapped = mapFeed(raw, { adapter, killField });
  return {
    ms: Date.now() - started,
    adapter: mapped.adapter,
    killField: mapped.killField,
    externalMatchId: mapped.externalMatchId,
    finished: mapped.finished,
    aliveTeams: mapped.aliveTeams,
    teamCount: mapped.teams.length,
    playerCount: mapped.teams.reduce((s, t) => s + (t.players?.length || 0), 0),
    totalKills: mapped.teams.reduce((s, t) => s + (t.kills || 0), 0),
    teams: mapped.teams,
  };
}

async function log(feed, status, message, extra = {}) {
  await prisma.feedLog.create({
    data: { feedId: feed.id, status, message: message ? String(message).slice(0, 500) : null, ...extra },
  }).catch(() => {});
  if (Math.random() < 0.05) {
    const old = await prisma.feedLog.findMany({
      where: { feedId: feed.id }, orderBy: { createdAt: 'desc' }, skip: 200, select: { id: true },
    }).catch(() => []);
    if (old.length) await prisma.feedLog.deleteMany({ where: { id: { in: old.map((o) => o.id) } } }).catch(() => {});
  }
}

/**
 * Stable identity for a feed that sends no matchId. One session = one match;
 * it only rolls over after a finished match is imported.
 */
async function resolveSessionKey(feed, mapped) {
  if (mapped.externalMatchId) return mapped.externalMatchId;
  if (feed.sessionKey) return feed.sessionKey;
  const key = `feed-${feed.id}-${Date.now().toString(36)}`;
  await prisma.feedSource.update({
    where: { id: feed.id }, data: { sessionKey: key, sessionStartedAt: new Date() },
  }).catch(() => {});
  return key;
}

export async function runFeed(feedInput, { force = false } = {}) {
  const feed = typeof feedInput === 'number'
    ? await prisma.feedSource.findUnique({ where: { id: feedInput } })
    : feedInput;
  if (!feed) throw new Error('Feed not found');

  const started = Date.now();
  const finish = (status, message, extra = {}) => prisma.feedSource.update({
    where: { id: feed.id },
    data: {
      lastRunAt: new Date(), lastStatus: status, lastMessage: message ? String(message).slice(0, 500) : null,
      ...(status === 'error' ? { errors: { increment: 1 } } : {}),
      ...extra,
    },
  }).catch(() => {});

  try {
    const raw = await fetchFeed(feed);
    const mapped = mapFeed(raw, { adapter: feed.adapter, killField: feed.killField });

    if (mapped.teams.length < (feed.minTeams ?? 2)) {
      await finish('skipped', `Only ${mapped.teams.length} team(s) in feed — waiting`);
      return { status: 'skipped', message: 'not enough teams' };
    }
    if (feed.importWhen === 'finished' && !mapped.finished && !force) {
      await finish('waiting', `Match in progress — ${mapped.aliveTeams} team(s) still alive`);
      return { status: 'waiting', message: 'match still live' };
    }

    const payloadHash = hash(mapped.teams);
    const externalMatchId = await resolveSessionKey(feed, mapped);

    if (!force && payloadHash === feed.lastHash && externalMatchId === feed.lastMatchKey) {
      await finish('unchanged', 'No change since last poll');
      return { status: 'unchanged' };
    }

    const result = await importMatch({
      tournament: feed.tournamentId,
      round: feed.roundId ?? feed.roundName ?? undefined,
      map: feed.mapName || undefined,
      externalMatchId,
      playedAt: mapped.playedAt || undefined,
      autoPublish: feed.autoPublish,
      finished: mapped.finished,
      createMissing: true,
      teams: mapped.teams,
    }, null, { source: 'feed' });

    await prisma.feedSource.update({
      where: { id: feed.id },
      data: {
        lastRunAt: new Date(), lastImportAt: new Date(), lastStatus: 'imported',
        lastMessage: `Match #${result.match.number} · ${result.teams} teams · ${result.players} players`,
        lastHash: payloadHash, lastMatchKey: externalMatchId, imports: { increment: 1 },
        // Match is over — the next poll starts a fresh session.
        ...(mapped.finished ? { sessionKey: null, sessionStartedAt: null } : {}),
      },
    });
    await log(feed, 'imported', `Match #${result.match.number} imported (${result.teams} teams)`, {
      matchKey: externalMatchId, matchId: result.match.id, teams: result.teams, ms: Date.now() - started,
    });
    return { status: 'imported', ...result };
  } catch (e) {
    const message = e.status === 423 ? 'Match is locked in UETMS — skipping until unlocked' : e.message;
    await finish(e.status === 423 ? 'locked' : 'error', message);
    await log(feed, e.status === 423 ? 'locked' : 'error', message, { ms: Date.now() - started });
    if (force) throw e;
    return { status: 'error', message };
  }
}

async function tick() {
  let feeds = [];
  try { feeds = await prisma.feedSource.findMany({ where: { isActive: true } }); }
  catch { return; }
  const live = new Set(feeds.map((f) => f.id));
  for (const id of state.keys()) if (!live.has(id)) state.delete(id);

  const now = Date.now();
  for (const feed of feeds) {
    const s = state.get(feed.id) || { nextAt: 0, running: false };
    state.set(feed.id, s);
    if (s.running || now < s.nextAt) continue;
    s.running = true;
    runFeed(feed)
      .catch(() => {})
      .finally(() => {
        s.running = false;
        s.nextAt = Date.now() + Math.max(MIN_INTERVAL, feed.intervalSec || 20) * 1000;
      });
  }
}

export function startFeedPoller() {
  if (timer) return;
  timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  timer.unref?.();
  console.log('  Feed poller : on (checks active feeds every 2s)');
}

export function stopFeedPoller() {
  if (timer) clearInterval(timer);
  timer = null;
  state.clear();
}

/** Reset the schedule so an edited feed polls immediately. */
export function wakeFeed(feedId) {
  const s = state.get(feedId);
  if (s) s.nextAt = 0;
}
