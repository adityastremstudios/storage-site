// Match operations: the full lifecycle from the spec, plus the manual-override
// endpoints that make AUTO FIRST / MANUAL ALWAYS real.
//
// Mounted alongside the existing matches router, so every existing endpoint
// keeps working exactly as before.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, minRole } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { logAudit } from '../middleware/audit.js';
import { recalcTournament } from '../services/statsEngine.js';
import { runRecalc, recalcMatchPoints } from '../services/recalcService.js';
import { applyStats, findDuplicateMatch } from '../services/importService.js';
import { publishTournamentSnapshots, bumpTournament } from '../services/publishService.js';

const r = Router();
r.use(authenticate);
const canWrite = minRole('TOURNAMENT_MANAGER');
const canEdit = minRole('DATA_ENTRY');

async function getMatch(id) {
  const match = await prisma.match.findFirst({
    where: { id: Number(id), deletedAt: null },
    include: { tournament: { include: { pointRule: true } }, round: true },
  });
  if (!match) throw httpError(404, 'Match not found');
  return match;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// Unlock used to clear isLocked but leave status stuck on LOCKED. statusBefore
// remembers what the match was, so unlocking restores it properly.
r.post('/:id(\\d+)/lock', canWrite, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    if (match.isLocked) return res.json({ ok: true, alreadyLocked: true, match });
    const updated = await prisma.match.update({
      where: { id: match.id },
      data: { isLocked: true, statusBefore: match.status, status: 'LOCKED' },
    });
    await logAudit(req, 'match', match.id, 'lock', match, updated);
    res.json({ ok: true, match: updated });
  } catch (e) { next(e); }
});

r.post('/:id(\\d+)/unlock', canWrite, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    const restored = match.statusBefore
      || (match.publishedAt ? 'PUBLISHED' : match.endedAt ? 'COMPLETED' : 'DRAFT');
    const updated = await prisma.match.update({
      where: { id: match.id },
      data: { isLocked: false, status: restored, statusBefore: null },
    });
    await logAudit(req, 'match', match.id, 'unlock', match, updated);
    res.json({ ok: true, match: updated, restoredStatus: restored });
  } catch (e) { next(e); }
});

// Publish used to ignore the lock entirely.
r.post('/:id(\\d+)/publish', canWrite, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    if (match.isLocked) throw httpError(423, 'Match is locked — unlock it before publishing');
    const statCount = await prisma.teamStat.count({ where: { matchId: match.id } });
    if (!statCount) throw httpError(400, 'Match has no stats to publish');
    const updated = await prisma.match.update({
      where: { id: match.id },
      data: { status: 'PUBLISHED', publishedAt: match.publishedAt || new Date() },
    });
    await recalcTournament(match.tournamentId, [match.roundId]);
    await publishTournamentSnapshots(match.tournament, match.id);
    await logAudit(req, 'match', match.id, 'publish', match, updated);
    res.json({ ok: true, match: updated });
  } catch (e) { next(e); }
});

r.post('/:id(\\d+)/unpublish', canWrite, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    if (match.isLocked) throw httpError(423, 'Match is locked — unlock it first');
    const updated = await prisma.match.update({
      where: { id: match.id }, data: { status: 'COMPLETED', publishedAt: null },
    });
    await recalcTournament(match.tournamentId, [match.roundId]);
    await bumpTournament(match.tournament);
    await logAudit(req, 'match', match.id, 'unpublish', match, updated);
    res.json({ ok: true, match: updated });
  } catch (e) { next(e); }
});

// Archive keeps the row and its history but drops it out of standings.
r.post('/:id(\\d+)/archive', canWrite, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    const updated = await prisma.match.update({
      where: { id: match.id },
      data: { archivedAt: new Date(), statusBefore: match.status, status: 'DRAFT' },
    });
    await recalcTournament(match.tournamentId, [match.roundId]);
    await logAudit(req, 'match', match.id, 'archive', match, updated);
    res.json({ ok: true, match: updated });
  } catch (e) { next(e); }
});

r.post('/:id(\\d+)/unarchive', canWrite, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    const updated = await prisma.match.update({
      where: { id: match.id },
      data: { archivedAt: null, status: match.statusBefore || 'COMPLETED', statusBefore: null },
    });
    await recalcTournament(match.tournamentId, [match.roundId]);
    await logAudit(req, 'match', match.id, 'unarchive', match, updated);
    res.json({ ok: true, match: updated });
  } catch (e) { next(e); }
});

r.post('/:id(\\d+)/clone', canWrite, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    const withStats = req.body?.withStats !== false;
    const targetRoundId = req.body?.roundId ? Number(req.body.roundId) : match.roundId;

    const max = await prisma.match.aggregate({
      where: { roundId: targetRoundId, deletedAt: null }, _max: { matchNumber: true },
    });

    const clone = await prisma.match.create({
      data: {
        tournamentId: match.tournamentId,
        roundId: targetRoundId,
        mapId: match.mapId,
        matchNumber: (max._max.matchNumber ?? 0) + 1,
        status: 'DRAFT',
        notes: match.notes,
        tags: match.tags,
        clonedFromId: match.id,
        // A clone must never inherit the source's external id — that is what
        // would make the next feed poll overwrite the wrong match.
        externalMatchId: null,
      },
    });

    if (withStats) {
      const [teamStats, playerStats] = await Promise.all([
        prisma.teamStat.findMany({ where: { matchId: match.id } }),
        prisma.playerStat.findMany({ where: { matchId: match.id } }),
      ]);
      await prisma.$transaction([
        prisma.teamStat.createMany({
          data: teamStats.map(({ id, matchId, ...rest }) => ({ ...rest, matchId: clone.id })),
        }),
        prisma.playerStat.createMany({
          data: playerStats.map(({ id, matchId, ...rest }) => ({ ...rest, matchId: clone.id })),
        }),
      ]);
    }

    await logAudit(req, 'match', clone.id, 'clone', null, { clonedFrom: match.id, withStats });
    res.status(201).json({ ok: true, match: clone, clonedFrom: match.id });
  } catch (e) { next(e); }
});

r.post('/:id(\\d+)/reimport', canWrite, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    if (match.isLocked) throw httpError(423, 'Match is locked — unlock it before re-importing');
    if (!match.rawJson) throw httpError(400, 'No stored payload for this match — re-send it from the source');
    const { importSchema } = await import('../services/importService.js');
    const payload = importSchema.parse(match.rawJson);
    const result = await applyStats(match, match.tournament, payload.teams, {
      publish: match.status === 'PUBLISHED',
      finished: true,
      actorId: req.user.id,
      source: 'manual',
      rawPayload: match.rawJson,
      note: req.body?.reason || 'Manual re-import',
    });
    await logAudit(req, 'match', match.id, 'reimport', null, result, req.body?.reason);
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

r.get('/:id(\\d+)/duplicates', async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    const teamIds = await prisma.teamStat.findMany({ where: { matchId: match.id }, select: { teamId: true } });
    const dup = await findDuplicateMatch(match.tournament, match.round, teamIds.map((t) => t.teamId), match.id);
    const sameNumber = await prisma.match.findMany({
      where: { roundId: match.roundId, matchNumber: match.matchNumber, deletedAt: null, id: { not: match.id } },
      select: { id: true, matchNumber: true, status: true, createdAt: true },
    });
    res.json({
      hasDuplicate: Boolean(dup) || sameNumber.length > 0,
      sameRoster: dup ? { id: dup.id, matchNumber: dup.matchNumber, status: dup.status } : null,
      sameMatchNumber: sameNumber,
    });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Notes and tags
// ---------------------------------------------------------------------------

r.patch('/:id(\\d+)/meta', canEdit, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    const data = {};
    if (req.body.notes !== undefined) data.notes = req.body.notes ? String(req.body.notes).slice(0, 5000) : null;
    if (req.body.tags !== undefined) {
      if (!Array.isArray(req.body.tags)) throw httpError(400, 'tags must be an array of strings');
      data.tags = req.body.tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 20);
    }
    if (!Object.keys(data).length) throw httpError(400, 'Send notes and/or tags');
    const updated = await prisma.match.update({ where: { id: match.id }, data });
    await logAudit(req, 'match', match.id, 'update-meta', match, updated);
    res.json({ ok: true, match: updated });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

r.get('/:id(\\d+)/versions', async (req, res, next) => {
  try {
    const matchId = Number(req.params.id);
    const items = await prisma.matchVersion.findMany({
      where: { matchId }, orderBy: { version: 'desc' }, take: 50,
      select: {
        id: true, version: true, hash: true, source: true, note: true, createdAt: true,
        actor: { select: { id: true, username: true } },
      },
    });
    res.json({ items });
  } catch (e) { next(e); }
});

r.get('/:id(\\d+)/versions/:version(\\d+)', async (req, res, next) => {
  try {
    const version = await prisma.matchVersion.findUnique({
      where: { matchId_version: { matchId: Number(req.params.id), version: Number(req.params.version) } },
      include: { actor: { select: { id: true, username: true } } },
    });
    if (!version) throw httpError(404, 'Version not found');
    res.json(version);
  } catch (e) { next(e); }
});

r.get('/:id(\\d+)/versions/compare', async (req, res, next) => {
  try {
    const matchId = Number(req.params.id);
    const a = Number(req.query.a);
    const b = Number(req.query.b);
    if (!a || !b) throw httpError(400, 'Pass two versions: ?a=1&b=2');
    const [va, vb] = await Promise.all([
      prisma.matchVersion.findUnique({ where: { matchId_version: { matchId, version: a } } }),
      prisma.matchVersion.findUnique({ where: { matchId_version: { matchId, version: b } } }),
    ]);
    if (!va || !vb) throw httpError(404, 'One of those versions does not exist');

    const index = (teams) => {
      const map = new Map();
      for (const t of teams || []) {
        const name = typeof t.team === 'string' ? t.team : `team:${t.team}`;
        map.set(name, {
          placement: t.placement, kills: t.kills ?? null,
          players: Object.fromEntries((t.players || []).map((p) => [p.ign, { kills: p.kills ?? null, damage: p.damage ?? null }])),
        });
      }
      return map;
    };
    const ia = index(va.mappedTeams);
    const ib = index(vb.mappedTeams);
    const diffs = [];
    for (const name of new Set([...ia.keys(), ...ib.keys()])) {
      const x = ia.get(name); const y = ib.get(name);
      if (!x) { diffs.push({ team: name, change: 'added' }); continue; }
      if (!y) { diffs.push({ team: name, change: 'removed' }); continue; }
      const fieldDiffs = [];
      if (x.placement !== y.placement) fieldDiffs.push({ field: 'placement', from: x.placement, to: y.placement });
      if (x.kills !== y.kills) fieldDiffs.push({ field: 'kills', from: x.kills, to: y.kills });
      for (const ign of new Set([...Object.keys(x.players), ...Object.keys(y.players)])) {
        const px = x.players[ign]; const py = y.players[ign];
        if (!px) { fieldDiffs.push({ field: `player:${ign}`, from: null, to: 'added' }); continue; }
        if (!py) { fieldDiffs.push({ field: `player:${ign}`, from: 'removed', to: null }); continue; }
        if (px.kills !== py.kills) fieldDiffs.push({ field: `${ign}.kills`, from: px.kills, to: py.kills });
        if (px.damage !== py.damage) fieldDiffs.push({ field: `${ign}.damage`, from: px.damage, to: py.damage });
      }
      if (fieldDiffs.length) diffs.push({ team: name, change: 'modified', diffs: fieldDiffs });
    }
    res.json({
      a: { version: va.version, createdAt: va.createdAt, source: va.source },
      b: { version: vb.version, createdAt: vb.createdAt, source: vb.source },
      identical: diffs.length === 0,
      diffs,
    });
  } catch (e) { next(e); }
});

r.post('/:id(\\d+)/versions/:version(\\d+)/restore', canWrite, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    if (match.isLocked) throw httpError(423, 'Match is locked — unlock it before restoring');
    const version = await prisma.matchVersion.findUnique({
      where: { matchId_version: { matchId: match.id, version: Number(req.params.version) } },
    });
    if (!version) throw httpError(404, 'Version not found');
    if (!version.mappedTeams) throw httpError(400, 'That version has no restorable payload');

    const result = await applyStats(match, match.tournament, version.mappedTeams, {
      publish: match.status === 'PUBLISHED',
      finished: true,
      actorId: req.user.id,
      source: 'manual',
      note: `Restored from version ${version.version}`,
    });
    await logAudit(req, 'match', match.id, 'restore-version', null,
      { restoredFrom: version.version, newVersion: result.version }, req.body?.reason);
    res.json({ ok: true, restoredFrom: version.version, ...result });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Manual overrides — the core of AUTO FIRST / MANUAL ALWAYS
// ---------------------------------------------------------------------------

const TEAM_EDITABLE = new Set(['placement', 'kills', 'damage', 'survivalTime', 'damageTaken']);
const PLAYER_EDITABLE = new Set([
  'kills', 'damage', 'assists', 'knocks', 'revives', 'headshots', 'survivalTime',
  'deaths', 'knockedDown', 'longestKill', 'heals', 'boosts', 'clutches',
]);

r.patch('/:id(\\d+)/team-stats/:teamId(\\d+)', canEdit, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    if (match.isLocked) throw httpError(423, 'Match is locked');
    const teamId = Number(req.params.teamId);
    const reason = req.body?.reason;
    if (!reason) throw httpError(400, 'A reason is required for manual edits');

    const stat = await prisma.teamStat.findUnique({ where: { matchId_teamId: { matchId: match.id, teamId } } });
    if (!stat) throw httpError(404, 'No stat row for that team in this match');

    const overrides = { ...(stat.overrides || {}) };
    for (const [k, v] of Object.entries(req.body.values || {})) {
      if (!TEAM_EDITABLE.has(k)) throw httpError(400, `Field "${k}" is not editable`);
      if (v === null) delete overrides[k];   // clearing an override restores the imported value
      else overrides[k] = Number(v);
    }

    const merged = { placement: stat.placement, kills: stat.kills, damage: stat.damage, ...overrides };
    const { resolveRule, computePoints } = await import('../services/statsEngine.js');
    const pts = computePoints(merged.placement, merged.kills, resolveRule(match.tournament));

    const updated = await prisma.teamStat.update({
      where: { id: stat.id },
      data: {
        ...merged, ...pts,
        isWWCD: merged.placement === 1,
        overrides: Object.keys(overrides).length ? overrides : null,
        source: Object.keys(overrides).length ? 'MANUAL' : 'IMPORT',
      },
    });

    await recalcTournament(match.tournamentId, [match.roundId]);
    await logAudit(req, 'teamStat', stat.id, 'manual-override', stat, updated, reason);
    res.json({ ok: true, stat: updated });
  } catch (e) { next(e); }
});

r.patch('/:id(\\d+)/player-stats/:playerId(\\d+)', canEdit, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    if (match.isLocked) throw httpError(423, 'Match is locked');
    const playerId = Number(req.params.playerId);
    const reason = req.body?.reason;
    if (!reason) throw httpError(400, 'A reason is required for manual edits');

    const stat = await prisma.playerStat.findUnique({ where: { matchId_playerId: { matchId: match.id, playerId } } });
    if (!stat) throw httpError(404, 'No stat row for that player in this match');

    const overrides = { ...(stat.overrides || {}) };
    for (const [k, v] of Object.entries(req.body.values || {})) {
      if (!PLAYER_EDITABLE.has(k)) throw httpError(400, `Field "${k}" is not editable`);
      if (v === null) delete overrides[k];
      else overrides[k] = Number(v);
    }

    const { mvpScore } = await import('../services/statsEngine.js');
    const merged = { ...stat, ...overrides };
    const updated = await prisma.playerStat.update({
      where: { id: stat.id },
      data: {
        ...overrides,
        mvpScore: mvpScore(merged),
        overrides: Object.keys(overrides).length ? overrides : null,
        source: Object.keys(overrides).length ? 'MANUAL' : 'IMPORT',
      },
    });

    await recalcMatchPoints(match);
    await logAudit(req, 'playerStat', stat.id, 'manual-override', stat, updated, reason);
    res.json({ ok: true, stat: updated });
  } catch (e) { next(e); }
});

// Undo: clear every override on the match and rebuild from the last import.
r.post('/:id(\\d+)/clear-overrides', canWrite, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    if (match.isLocked) throw httpError(423, 'Match is locked');
    const [t, p] = await prisma.$transaction([
      prisma.teamStat.updateMany({ where: { matchId: match.id }, data: { overrides: null, source: 'IMPORT' } }),
      prisma.playerStat.updateMany({ where: { matchId: match.id }, data: { overrides: null, source: 'IMPORT' } }),
    ]);
    if (match.rawJson) {
      const { importSchema } = await import('../services/importService.js');
      const payload = importSchema.parse(match.rawJson);
      await applyStats(match, match.tournament, payload.teams, {
        publish: match.status === 'PUBLISHED', finished: true, actorId: req.user.id,
        source: 'manual', note: 'Cleared all manual overrides',
      });
    } else {
      await recalcMatchPoints(match);
      await recalcTournament(match.tournamentId, [match.roundId]);
    }
    await logAudit(req, 'match', match.id, 'clear-overrides', null,
      { teamRows: t.count, playerRows: p.count }, req.body?.reason);
    res.json({ ok: true, cleared: { teamStats: t.count, playerStats: p.count } });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Penalties
// ---------------------------------------------------------------------------

r.get('/:id(\\d+)/penalties', async (req, res, next) => {
  try {
    const items = await prisma.penalty.findMany({
      where: { matchId: Number(req.params.id) },
      include: {
        team: { select: { id: true, name: true, logoUrl: true } },
        createdBy: { select: { id: true, username: true } },
      },
      orderBy: { id: 'desc' },
    });
    res.json({ items });
  } catch (e) { next(e); }
});

r.post('/:id(\\d+)/penalties', canWrite, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    const { teamId, points, reason } = req.body || {};
    if (!teamId || points === undefined || !reason) {
      throw httpError(400, 'teamId, points and reason are all required');
    }
    const penalty = await prisma.penalty.create({
      data: {
        tournamentId: match.tournamentId, matchId: match.id, teamId: Number(teamId),
        points: Number(points), reason: String(reason).slice(0, 500), createdById: req.user.id,
      },
    });
    await recalcMatchPoints(match);
    await recalcTournament(match.tournamentId, [match.roundId]);
    await logAudit(req, 'penalty', penalty.id, 'create', null, penalty, reason);
    res.status(201).json({ ok: true, penalty });
  } catch (e) { next(e); }
});

r.delete('/penalties/:penaltyId(\\d+)', canWrite, async (req, res, next) => {
  try {
    const penalty = await prisma.penalty.findUnique({ where: { id: Number(req.params.penaltyId) } });
    if (!penalty) throw httpError(404, 'Penalty not found');
    await prisma.penalty.delete({ where: { id: penalty.id } });
    if (penalty.matchId) {
      const match = await getMatch(penalty.matchId);
      await recalcMatchPoints(match);
    }
    await recalcTournament(penalty.tournamentId);
    await logAudit(req, 'penalty', penalty.id, 'delete', penalty, null, req.body?.reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Per-match recalculation
// ---------------------------------------------------------------------------

r.post('/:id(\\d+)/recalc', canWrite, async (req, res, next) => {
  try {
    const match = await getMatch(req.params.id);
    const result = await runRecalc({
      tournamentId: match.tournamentId, scope: 'match', matchId: match.id, actorId: req.user.id,
    });
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

export default r;
