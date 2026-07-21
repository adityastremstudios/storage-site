// Phase 9 pipeline: JSON in → validate → resolve/auto-create → save → recalc → publish → refresh.
// Idempotent: re-sending the same externalMatchId replaces that match's stats instead of duplicating.
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { httpError } from '../middleware/error.js';
import { uniqueSlug } from '../utils/slug.js';
import { resolveRule, computePoints, mvpScore, recalcTournament } from './statsEngine.js';
import { publishTournamentSnapshots, bumpTournament } from './publishService.js';

const playerSchema = z.object({
  ign: z.string().min(1),
  kills: z.coerce.number().int().min(0).default(0),
  damage: z.coerce.number().min(0).default(0),
  assists: z.coerce.number().int().min(0).default(0),
  knocks: z.coerce.number().int().min(0).default(0),
  revives: z.coerce.number().int().min(0).default(0),
  headshots: z.coerce.number().int().min(0).default(0),
  survivalTime: z.coerce.number().min(0).optional(),
});

const teamEntrySchema = z.object({
  team: z.union([z.string().min(1), z.number().int()]),
  shortName: z.string().optional(),
  placement: z.coerce.number().int().min(1),
  kills: z.coerce.number().int().min(0).optional(),
  damage: z.coerce.number().min(0).optional(),
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
  teams: z.array(teamEntrySchema).min(2),
});

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
  const t = await prisma.tournament.findFirst({ where: { ...where, deletedAt: null }, include: { pointRule: true, game: true } });
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
    const byName = await prisma.round.findFirst({ where: { tournamentId: tournament.id, name: { equals: String(ref), mode: 'insensitive' } } });
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
    where: { deletedAt: null, OR: [{ slug: name.toLowerCase() }, { name: { equals: name, mode: 'insensitive' } }, { shortName: { equals: name, mode: 'insensitive' } }] },
  });
  if (found) return found;
  if (!createMissing) throw httpError(404, `Team "${name}" not found`);
  const slug = await uniqueSlug(prisma.team, name);
  return prisma.team.create({ data: { name, slug, shortName: entry.shortName || name.slice(0, 4).toUpperCase() } });
}

async function resolvePlayer(p, team, createMissing) {
  const found = await prisma.player.findFirst({ where: { ign: { equals: p.ign, mode: 'insensitive' }, deletedAt: null } });
  if (found) {
    if (!found.currentTeamId) await prisma.player.update({ where: { id: found.id }, data: { currentTeamId: team.id } });
    return found;
  }
  if (!createMissing) throw httpError(404, `Player "${p.ign}" not found`);
  const created = await prisma.player.create({ data: { ign: p.ign, currentTeamId: team.id } });
  await prisma.teamPlayer.create({ data: { teamId: team.id, playerId: created.id } });
  return created;
}

async function ensureMap(tournament, mapName) {
  if (!mapName) return null;
  return prisma.gameMap.upsert({
    where: { gameId_name: { gameId: tournament.gameId, name: mapName } },
    update: {},
    create: { gameId: tournament.gameId, name: mapName },
  });
}

// Core: build/replace all stats for a match from a validated teams payload.
export async function applyStats(match, tournament, teams, { publish = false } = {}) {
  assertPlacementsUnique(teams);
  const rule = resolveRule(tournament);

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

  const playerRows = [];
  for (const pr of prepared) {
    for (const { player, stat } of pr.players) {
      playerRows.push({
        matchId: match.id, playerId: player.id, teamId: pr.team.id,
        kills: stat.kills || 0, damage: stat.damage || 0, assists: stat.assists || 0,
        knocks: stat.knocks || 0, revives: stat.revives || 0, headshots: stat.headshots || 0,
        survivalTime: stat.survivalTime ?? null, mvpScore: mvpScore(stat), isMvp: false,
      });
    }
  }
  if (playerRows.length) {
    let best = playerRows[0];
    for (const row of playerRows) if (row.mvpScore > best.mvpScore) best = row;
    best.isMvp = true;
  }

  const winner = prepared.find((p) => p.entry.placement === 1);

  await prisma.$transaction(async (tx) => {
    await tx.playerStat.deleteMany({ where: { matchId: match.id } });
    await tx.teamStat.deleteMany({ where: { matchId: match.id } });
    await tx.teamStat.createMany({
      data: prepared.map((pr) => {
        const pts = computePoints(pr.entry.placement, pr.teamKills, rule);
        return {
          matchId: match.id, teamId: pr.team.id, placement: pr.entry.placement,
          kills: pr.teamKills, damage: pr.teamDamage, isWWCD: pr.entry.placement === 1, ...pts,
        };
      }),
    });
    if (playerRows.length) await tx.playerStat.createMany({ data: playerRows });
    await tx.match.update({
      where: { id: match.id },
      data: {
        winnerTeamId: winner ? winner.team.id : null,
        endedAt: match.endedAt || new Date(),
        status: publish ? 'PUBLISHED' : 'COMPLETED',
      },
    });
  }, { timeout: 30000 });

  await recalcTournament(tournament.id, [match.roundId]);
  await bumpTournament(tournament);
  if (publish) await publishTournamentSnapshots(tournament, match.id);
  return { matchId: match.id, teams: prepared.length, players: playerRows.length, published: publish };
}

export async function importMatch(rawPayload, connector = null) {
  const payload = importSchema.parse(rawPayload);
  const tournament = await resolveTournament(payload.tournament);
  const round = await resolveRound(tournament, payload.round, payload.createMissing);
  if (round.isLocked) throw httpError(423, `Round "${round.name}" is locked`);
  const map = await ensureMap(tournament, payload.map);

  let match = null;
  if (payload.externalMatchId) {
    match = await prisma.match.findUnique({ where: { externalMatchId: payload.externalMatchId } });
    if (match && match.isLocked) throw httpError(423, 'Match is locked — unlock it before re-importing');
  }
  if (!match) {
    const max = await prisma.match.aggregate({ where: { roundId: round.id, deletedAt: null }, _max: { matchNumber: true } });
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
      data: { roundId: round.id, mapId: map?.id ?? match.mapId, rawJson: rawPayload, matchNumber: payload.matchNumber ?? match.matchNumber },
    });
  }

  const result = await applyStats(match, tournament, payload.teams, { publish: payload.autoPublish });

  if (connector) {
    await prisma.apiConnector.update({
      where: { id: connector.id },
      data: { imports: { increment: 1 }, lastUsedAt: new Date() },
    }).catch(() => {});
  }
  return {
    ok: true,
    tournament: { id: tournament.id, slug: tournament.slug },
    round: { id: round.id, name: round.name },
    match: { id: match.id, number: match.matchNumber },
    ...result,
  };
}
