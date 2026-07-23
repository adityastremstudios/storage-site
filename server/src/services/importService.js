// Import pipeline: JSON in → validate → resolve → merge with manual overrides
// → save → version → recalc → publish → refresh.
//
// Three behaviours changed from the original, all of them data-integrity fixes:
//   1. externalMatchId is looked up per tournament, not globally, so two feeds
//      sending the same matchId can no longer overwrite each other's match.
//   2. Stats are merged, not wiped. A value a human corrected survives the next
//      poll — that is what makes AUTO FIRST / MANUAL ALWAYS actually work.
//   3. Stats the source never sent are recorded as "not provided" rather than
//      stored as a real zero, so averages and records skip them.
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { httpError } from '../middleware/error.js';
import { uniqueSlug } from '../utils/slug.js';
import {
  resolveRule, computePoints, mvpScore, recalcTournament,
  PLAYER_STAT_KEYS, TEAM_STAT_KEYS,
} from './statsEngine.js';
import { publishTournamentSnapshots, bumpTournament } from './publishService.js';

// Stats are optional rather than defaulted so we can tell "sent 0" apart from
// "never sent". Storage still writes 0 into the numeric columns for backward
// compatibility; the difference is recorded in `provided`.
const optInt = z.coerce.number().int().min(0).optional();
const optNum = z.coerce.number().min(0).optional();

const playerSchema = z.object({
  ign: z.string().min(1),
  externalId: z.string().max(120).optional(),
  kills: optInt,
  damage: optNum,
  assists: optInt,
  knocks: optInt,
  revives: optInt,
  headshots: optInt,
  survivalTime: optNum,
  deaths: optInt,
  knockedDown: optInt,
  longestKill: optNum,
  distance: optNum,
  heals: optInt,
  boosts: optInt,
  selfDamage: optNum,
  teamDamage: optNum,
  clutches: optInt,
});

const teamEntrySchema = z.object({
  team: z.union([z.string().min(1), z.number().int()]),
  shortName: z.string().optional(),
  logoUrl: z.string().optional(),
  placement: z.coerce.number().int().min(1),
  kills: optInt,
  damage: optNum,
  survivalTime: optNum,   // was silently stripped by the old schema
  damageTaken: optNum,
  players: z.array(playerSchema).default([]),
});

export const importSchema = z.object({
  tournament: z.union([z.string().min(1), z.number().int()]),
  round: z.union([z.string().min(1), z.number().int()]).optional(),
  externalMatchId: z.string().max(120).optional(),
  matchNumber: z.coerce.number().int().min(1).optional(),
  map: z.string().optional(),
  playedAt: z.string().optional(),
  autoPublish: z.boolean().default(true),
  createMissing: z.boolean().default(true),
  finished: z.boolean().default(true),
  teams: z.array(teamEntrySchema).min(2),
});

const hashOf = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex');

function providedKeys(entry, keys) {
  return keys.filter((k) => entry[k] !== undefined && entry[k] !== null);
}

function assertPlacementsUnique(teams) {
  const seen = new Set();
  for (const t of teams) {
    if (seen.has(t.placement)) throw httpError(400, `Duplicate placement ${t.placement} — every team needs a unique placement`);
    seen.add(t.placement);
  }
}

async function resolveTournament(ref) {
  const where = typeof ref === 'number' || /^\d+$/.test(String(ref))
    ? { id: Number(ref) } : { slug: String(ref) };
  const t = await prisma.tournament.findFirst({
    where: { ...where, deletedAt: null }, include: { pointRule: true, game: true },
  });
  if (!t) throw httpError(404, 'Tournament not found');
  return t;
}

async function resolveRound(tournament, ref, createMissing) {
  if (ref !== undefined && ref !== null && ref !== '') {
    if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
      const r = await prisma.round.findFirst({ where: { id: Number(ref), tournamentId: tournament.id } });
      if (!r) throw httpError(404, 'Round not found in this tournament');
      return r;
    }
    const byName = await prisma.round.findFirst({
      where: { tournamentId: tournament.id, name: { equals: String(ref), mode: 'insensitive' } },
    });
    if (byName) return byName;
    if (!createMissing) throw httpError(404, `Round "${ref}" not found`);
    const max = await prisma.round.aggregate({ where: { tournamentId: tournament.id }, _max: { order: true } });
    return prisma.round.create({ data: { tournamentId: tournament.id, name: String(ref), order: (max._max.order ?? 0) + 1 } });
  }
  const latest = await prisma.round.findFirst({ where: { tournamentId: tournament.id }, orderBy: { order: 'desc' } });
  if (latest) return latest;
  if (!createMissing) throw httpError(400, 'No round exists — create one first or send "round" in the payload');
  return prisma.round.create({ data: { tournamentId: tournament.id, name: 'Round 1', order: 1 } });
}

async function resolveTeam(entry, tournament, createMissing) {
  const ref = entry.team;
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
    const t = await prisma.team.findFirst({ where: { id: Number(ref), deletedAt: null } });
    if (!t) throw httpError(404, `Team id ${ref} not found`);
    return t;
  }
  const name = String(ref).trim();
  const found = await prisma.team.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { slug: name.toLowerCase() },
        { name: { equals: name, mode: 'insensitive' } },
        { shortName: { equals: name, mode: 'insensitive' } },
      ],
    },
  });
  if (found) {
    const patch = {};
    if (entry.logoUrl && !found.logoUrl) patch.logoUrl = entry.logoUrl;
    if (entry.shortName && !found.shortName) patch.shortName = entry.shortName;
    if (Object.keys(patch).length) return prisma.team.update({ where: { id: found.id }, data: patch });
    return found;
  }
  if (!createMissing) throw httpError(404, `Team "${name}" not found`);
  const slug = await uniqueSlug(prisma.team, name);
  return prisma.team.create({
    data: { name, slug, shortName: entry.shortName || name.slice(0, 4).toUpperCase(), logoUrl: entry.logoUrl || null },
  });
}

/**
 * Player identity, in priority order:
 *   1. externalId  — the game's own UID, the only truly stable identifier
 *   2. this team's roster — an IGN on the roster is that roster's player
 *   3. a globally unambiguous IGN — exactly one match and no team conflict
 *   4. create a new player
 *
 * The old version matched IGN globally, so two different people called "Ace"
 * on two different teams silently became one player and merged their careers.
 */
async function resolvePlayer(p, team, createMissing) {
  if (p.externalId) {
    const byExt = await prisma.player.findFirst({ where: { externalId: String(p.externalId), deletedAt: null } });
    if (byExt) {
      await ensureMembership(byExt, team);
      return byExt;
    }
  }

  const ign = String(p.ign).trim();

  const onRoster = await prisma.player.findFirst({
    where: {
      deletedAt: null,
      OR: [{ ign: { equals: ign, mode: 'insensitive' } }, { aliases: { has: ign } }],
      memberships: { some: { teamId: team.id, leftAt: null } },
    },
  });
  if (onRoster) return onRoster;

  const sameIgn = await prisma.player.findMany({
    where: { deletedAt: null, ign: { equals: ign, mode: 'insensitive' } },
    take: 2,
    include: { memberships: { where: { leftAt: null }, select: { teamId: true } } },
  });

  if (sameIgn.length === 1) {
    const candidate = sameIgn[0];
    const teams = candidate.memberships.map((m) => m.teamId);
    // Unattached, or already on this team → same person. Attached elsewhere →
    // ambiguous, so create a distinct player instead of corrupting both.
    if (!teams.length || teams.includes(team.id)) {
      await ensureMembership(candidate, team);
      if (!candidate.currentTeamId) {
        await prisma.player.update({ where: { id: candidate.id }, data: { currentTeamId: team.id } });
      }
      return candidate;
    }
  }

  if (!createMissing) throw httpError(404, `Player "${ign}" not found`);
  const created = await prisma.player.create({
    data: { ign, currentTeamId: team.id, externalId: p.externalId ? String(p.externalId) : null },
  });
  await prisma.teamPlayer.create({ data: { teamId: team.id, playerId: created.id } });
  return created;
}

async function ensureMembership(player, team) {
  const existing = await prisma.teamPlayer.findFirst({
    where: { playerId: player.id, teamId: team.id, leftAt: null },
  });
  if (existing) return;
  // Close the old roster row so transfer history stays truthful.
  await prisma.teamPlayer.updateMany({
    where: { playerId: player.id, leftAt: null },
    data: { leftAt: new Date(), isActive: false },
  });
  await prisma.teamPlayer.create({ data: { teamId: team.id, playerId: player.id } });
  await prisma.player.update({ where: { id: player.id }, data: { currentTeamId: team.id } });
}

async function ensureMap(tournament, mapName) {
  if (!mapName) return null;
  return prisma.gameMap.upsert({
    where: { gameId_name: { gameId: tournament.gameId, name: mapName } },
    update: {},
    create: { gameId: tournament.gameId, name: mapName },
  });
}

// Manual overrides win over anything the feed sends, until they are cleared.
function applyOverrides(base, overrides) {
  if (!overrides || typeof overrides !== 'object') return base;
  const merged = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null || v === undefined) continue;
    merged[k] = v;
  }
  return merged;
}

/**
 * Look for a match in the same round that already holds this exact set of
 * teams. Reported as a warning rather than an error — the operator decides.
 */
export async function findDuplicateMatch(tournament, round, teamIds, excludeMatchId = null) {
  const candidates = await prisma.match.findMany({
    where: {
      tournamentId: tournament.id,
      roundId: round.id,
      deletedAt: null,
      archivedAt: null,
      ...(excludeMatchId ? { id: { not: excludeMatchId } } : {}),
    },
    include: { teamStats: { select: { teamId: true } } },
  });
  const wanted = [...teamIds].sort().join(',');
  return candidates.find((m) => m.teamStats.length && [...m.teamStats.map((s) => s.teamId)].sort().join(',') === wanted) || null;
}

/** Core: build/merge all stats for a match from a validated teams payload. */
export async function applyStats(match, tournament, teams, opts = {}) {
  const { publish = false, finished = true, actorId = null, source = 'import', rawPayload = null, note = null } = opts;
  assertPlacementsUnique(teams);
  const rule = resolveRule(tournament);

  const [existingTeamStats, existingPlayerStats] = await Promise.all([
    prisma.teamStat.findMany({ where: { matchId: match.id } }),
    prisma.playerStat.findMany({ where: { matchId: match.id } }),
  ]);
  const prevTeam = new Map(existingTeamStats.map((s) => [s.teamId, s]));
  const prevPlayer = new Map(existingPlayerStats.map((s) => [s.playerId, s]));

  const prepared = [];
  for (const entry of teams) {
    const team = await resolveTeam(entry, tournament, true);
    await prisma.tournamentTeam.upsert({
      where: { tournamentId_teamId: { tournamentId: tournament.id, teamId: team.id } },
      update: {}, create: { tournamentId: tournament.id, teamId: team.id },
    });
    const players = [];
    for (const p of entry.players || []) {
      const player = await resolvePlayer(p, team, true);
      players.push({ player, stat: p });
    }
    const teamKills = entry.kills ?? players.reduce((s, x) => s + (x.stat.kills || 0), 0);
    const teamDamage = entry.damage ?? players.reduce((s, x) => s + (x.stat.damage || 0), 0);
    prepared.push({ team, entry, players, teamKills, teamDamage });
  }

  // ---- team rows -----------------------------------------------------------
  const teamRows = prepared.map((pr) => {
    const prev = prevTeam.get(pr.team.id);
    const anyPlayerDamage = pr.players.some((x) => x.stat.damage !== undefined);
    const provided = new Set(providedKeys(pr.entry, TEAM_STAT_KEYS));
    if (pr.entry.kills === undefined && pr.players.length) provided.add('kills');
    if (pr.entry.damage === undefined && anyPlayerDamage) provided.add('damage');

    const imported = {
      placement: pr.entry.placement,
      kills: pr.teamKills || 0,
      damage: pr.teamDamage || 0,
      survivalTime: pr.entry.survivalTime ?? null,
      damageTaken: pr.entry.damageTaken ?? null,
    };
    const merged = applyOverrides(imported, prev?.overrides);
    const pts = computePoints(merged.placement, merged.kills, rule);
    return {
      matchId: match.id,
      teamId: pr.team.id,
      placement: merged.placement,
      kills: merged.kills,
      damage: merged.damage,
      survivalTime: merged.survivalTime,
      damageTaken: merged.damageTaken,
      isWWCD: merged.placement === 1,
      source: prev?.overrides && Object.keys(prev.overrides).length ? 'MANUAL' : 'IMPORT',
      overrides: prev?.overrides ?? null,
      provided: [...provided],
      penaltyPoints: prev?.penaltyPoints ?? 0,
      ...pts,
    };
  });

  // ---- player rows ---------------------------------------------------------
  const playerRows = [];
  for (const pr of prepared) {
    for (const { player, stat } of pr.players) {
      const prev = prevPlayer.get(player.id);
      const provided = providedKeys(stat, PLAYER_STAT_KEYS);
      const imported = {};
      for (const k of PLAYER_STAT_KEYS) imported[k] = stat[k] ?? null;
      const merged = applyOverrides(imported, prev?.overrides);
      const zero = (v) => (v === null || v === undefined ? 0 : v);
      playerRows.push({
        matchId: match.id,
        playerId: player.id,
        teamId: pr.team.id,
        kills: zero(merged.kills),
        damage: zero(merged.damage),
        assists: zero(merged.assists),
        knocks: zero(merged.knocks),
        revives: zero(merged.revives),
        headshots: zero(merged.headshots),
        survivalTime: merged.survivalTime,
        deaths: merged.deaths,
        knockedDown: merged.knockedDown,
        longestKill: merged.longestKill,
        distance: merged.distance,
        heals: merged.heals,
        boosts: merged.boosts,
        selfDamage: merged.selfDamage,
        teamDamage: merged.teamDamage,
        clutches: merged.clutches,
        mvpScore: mvpScore(merged),
        isMvp: false,
        source: prev?.overrides && Object.keys(prev.overrides).length ? 'MANUAL' : 'IMPORT',
        overrides: prev?.overrides ?? null,
        provided,
      });
    }
  }
  if (playerRows.length) {
    let best = playerRows[0];
    for (const row of playerRows) if (row.mvpScore > best.mvpScore) best = row;
    best.isMvp = true;
  }

  const winner = teamRows.find((t) => t.placement === 1);
  const payloadHash = hashOf({ teams: teamRows.map((t) => ({ ...t, matchId: 0 })), players: playerRows.map((p) => ({ ...p, matchId: 0 })) });
  const changed = payloadHash !== (await lastVersionHash(match.id));

  const keepTeamIds = new Set(teamRows.map((t) => t.teamId));
  const keepPlayerIds = new Set(playerRows.map((p) => p.playerId));

  await prisma.$transaction(async (tx) => {
    // Snapshot before touching anything — this is the Version History source.
    if (changed) {
      await tx.matchVersion.create({
        data: {
          matchId: match.id,
          version: (match.currentVersion || 0) + 1,
          hash: payloadHash,
          source,
          rawPayload: rawPayload ?? undefined,
          mappedTeams: JSON.parse(JSON.stringify(teams)),
          statsBefore: existingTeamStats.length || existingPlayerStats.length
            ? JSON.parse(JSON.stringify({ teamStats: existingTeamStats, playerStats: existingPlayerStats }))
            : undefined,
          note,
          actorId,
        },
      });
    }

    // Remove only rows that are genuinely gone from the payload, and never a
    // row a human has edited.
    await tx.teamStat.deleteMany({
      where: { matchId: match.id, teamId: { notIn: [...keepTeamIds] }, source: { not: 'MANUAL' } },
    });
    await tx.playerStat.deleteMany({
      where: { matchId: match.id, playerId: { notIn: [...keepPlayerIds] }, source: { not: 'MANUAL' } },
    });

    for (const row of teamRows) {
      const { matchId, teamId, ...rest } = row;
      await tx.teamStat.upsert({
        where: { matchId_teamId: { matchId, teamId } },
        update: rest,
        create: row,
      });
    }
    for (const row of playerRows) {
      const { matchId, playerId, ...rest } = row;
      await tx.playerStat.upsert({
        where: { matchId_playerId: { matchId, playerId } },
        update: rest,
        create: row,
      });
    }

    await tx.match.update({
      where: { id: match.id },
      data: {
        winnerTeamId: winner ? winner.teamId : null,
        // Never un-finish a match that already ended just because a stale live
        // payload arrived afterwards.
        endedAt: finished ? (match.endedAt || new Date()) : match.endedAt,
        status: publish ? 'PUBLISHED' : 'COMPLETED',
        publishedAt: publish ? (match.publishedAt || new Date()) : match.publishedAt,
        importCount: { increment: 1 },
        lastImportAt: new Date(),
        ...(changed ? { currentVersion: (match.currentVersion || 0) + 1 } : {}),
      },
    });
  }, { timeout: 30000 });

  await recalcTournament(tournament.id, [match.roundId]);
  await bumpTournament(tournament);
  if (publish) await publishTournamentSnapshots(tournament, match.id);

  return {
    matchId: match.id,
    teams: teamRows.length,
    players: playerRows.length,
    published: publish,
    versioned: changed,
    version: changed ? (match.currentVersion || 0) + 1 : match.currentVersion,
  };
}

async function lastVersionHash(matchId) {
  const v = await prisma.matchVersion.findFirst({
    where: { matchId }, orderBy: { version: 'desc' }, select: { hash: true },
  });
  return v?.hash ?? null;
}

export async function importMatch(rawPayload, connector = null, ctx = {}) {
  const payload = importSchema.parse(rawPayload);
  const tournament = await resolveTournament(payload.tournament);

  if (connector) {
    const allowed = connector.tournamentIds || [];
    if (allowed.length && !allowed.includes(tournament.id)) {
      throw httpError(403, 'This API key is not allowed to import into that tournament');
    }
  }

  const round = await resolveRound(tournament, payload.round, payload.createMissing);
  if (round.isLocked) throw httpError(423, `Round "${round.name}" is locked`);
  const map = await ensureMap(tournament, payload.map);

  let match = null;
  if (payload.externalMatchId) {
    // Scoped to this tournament. The old global findUnique let one tournament
    // silently overwrite another tournament's match.
    match = await prisma.match.findFirst({
      where: { tournamentId: tournament.id, externalMatchId: payload.externalMatchId, deletedAt: null },
    });
    if (match && match.isLocked) throw httpError(423, 'Match is locked — unlock it before re-importing');
  }

  let duplicateWarning = null;
  if (!match) {
    const max = await prisma.match.aggregate({
      where: { roundId: round.id, deletedAt: null }, _max: { matchNumber: true },
    });
    match = await prisma.match.create({
      data: {
        tournamentId: tournament.id, roundId: round.id, mapId: map?.id ?? null,
        matchNumber: payload.matchNumber ?? (max._max.matchNumber ?? 0) + 1,
        externalMatchId: payload.externalMatchId ?? null,
        scheduledAt: payload.playedAt ? new Date(payload.playedAt) : null,
        startedAt: payload.playedAt ? new Date(payload.playedAt) : new Date(),
        status: 'LIVE', rawJson: rawPayload,
      },
    });
  } else {
    match = await prisma.match.update({
      where: { id: match.id },
      data: {
        roundId: round.id,
        mapId: map?.id ?? match.mapId,
        rawJson: rawPayload,
        matchNumber: payload.matchNumber ?? match.matchNumber,
      },
    });
  }

  const result = await applyStats(match, tournament, payload.teams, {
    publish: payload.autoPublish,
    finished: payload.finished,
    actorId: ctx.actorId ?? null,
    source: connector ? 'feed' : (ctx.source || 'import'),
    rawPayload,
  });

  // Duplicate detection runs after the stats land so we can compare rosters.
  const teamIds = await prisma.teamStat.findMany({ where: { matchId: match.id }, select: { teamId: true } });
  const dup = await findDuplicateMatch(tournament, round, teamIds.map((t) => t.teamId), match.id);
  if (dup) {
    duplicateWarning = `Match #${dup.matchNumber} in this round already has the same ${teamIds.length} teams — possible duplicate`;
  }

  if (connector) {
    await prisma.apiConnector.update({
      where: { id: connector.id },
      data: { imports: { increment: 1 }, lastUsedAt: new Date() },
    }).catch(() => {});
  }

  // Imports used to write nothing to the audit trail; the spec requires every
  // import to be in history.
  await prisma.auditLog.create({
    data: {
      userId: ctx.actorId ?? null,
      entity: 'match',
      entityId: match.id,
      action: connector ? 'import:api' : 'import:manual',
      after: {
        tournament: tournament.slug,
        round: round.name,
        externalMatchId: payload.externalMatchId ?? null,
        teams: result.teams,
        players: result.players,
        version: result.version,
        connector: connector?.name ?? null,
      },
      reason: ctx.reason ?? null,
      ip: ctx.ip ?? null,
    },
  }).catch(() => {});

  return {
    ok: true,
    tournament: { id: tournament.id, slug: tournament.slug },
    round: { id: round.id, name: round.name },
    match: { id: match.id, number: match.matchNumber },
    duplicateWarning,
    ...result,
  };
}
