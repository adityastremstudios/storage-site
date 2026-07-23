// Recalculation engine.
//
// The original recalc read outside its transaction, so two feed polls 20s apart
// could interleave and last-write-wins with stale numbers. Every recalculation
// now runs under a Postgres advisory lock keyed by tournament, and is recorded
// as a RecalcJob so the admin UI can show what ran, when and whether it failed.
import { prisma } from '../lib/prisma.js';
import { recalcTournament, recalcStandings } from './statsEngine.js';
import { recalcAggregates, recalcRecords, recalcAchievements } from './analyticsService.js';
import { bumpTournament } from './publishService.js';

export const SCOPES = ['match', 'round', 'tournament', 'players', 'teams', 'records', 'achievements', 'all'];

// Distinct namespace so this never collides with another advisory lock.
const LOCK_NAMESPACE = 918273;

async function withTournamentLock(tournamentId, fn) {
  // pg_advisory_xact_lock would release at transaction end; we need the lock to
  // span several transactions, so take a session lock and always release it.
  await prisma.$queryRaw`SELECT pg_advisory_lock(${LOCK_NAMESPACE}::int, ${tournamentId}::int)`;
  try {
    return await fn();
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_NAMESPACE}::int, ${tournamentId}::int)`
      .catch(() => {});
  }
}

/**
 * Run a recalculation.
 *
 * scope: 'match' | 'round' | 'tournament' | 'players' | 'teams' | 'records'
 *        | 'achievements' | 'all'
 */
export async function runRecalc({ tournamentId, scope = 'all', roundId = null, matchId = null, actorId = null }) {
  if (!SCOPES.includes(scope)) throw new Error(`Unknown recalc scope "${scope}"`);
  const tid = Number(tournamentId);

  const job = await prisma.recalcJob.create({
    data: { tournamentId: tid, scope, status: 'RUNNING', requestedById: actorId, startedAt: new Date() },
  });

  try {
    const result = await withTournamentLock(tid, async () => {
      const out = {};

      if (scope === 'match' && matchId) {
        const match = await prisma.match.findUnique({ where: { id: Number(matchId) } });
        if (!match) throw new Error('Match not found');
        await recalcMatchPoints(match);
        await recalcTournament(tid, [match.roundId]);
        out.match = match.id;
      }

      if (scope === 'round' && roundId) {
        const matches = await prisma.match.findMany({
          where: { roundId: Number(roundId), deletedAt: null }, select: { id: true },
        });
        for (const m of matches) await recalcMatchPoints(m);
        await recalcStandings(tid, `round:${Number(roundId)}`);
        await recalcStandings(tid, 'overall');
        out.round = Number(roundId);
        out.matches = matches.length;
      }

      if (['tournament', 'all'].includes(scope)) {
        const matches = await prisma.match.findMany({
          where: { tournamentId: tid, deletedAt: null }, select: { id: true },
        });
        for (const m of matches) await recalcMatchPoints(m);
        await recalcTournament(tid);
        out.matches = matches.length;
      }

      if (['players', 'teams', 'all'].includes(scope)) {
        out.aggregates = await recalcAggregates(tid);
      }
      if (['records', 'all'].includes(scope)) {
        out.records = await recalcRecords(tid);
        out.allTimeRecords = await recalcRecords(null);
      }
      if (['achievements', 'all'].includes(scope)) {
        out.achievements = await recalcAchievements(tid);
      }

      return out;
    });

    await prisma.recalcJob.update({
      where: { id: job.id }, data: { status: 'DONE', finishedAt: new Date() },
    });
    const tournament = await prisma.tournament.findUnique({ where: { id: tid } });
    if (tournament) await bumpTournament(tournament);

    return { jobId: job.id, scope, ...result };
  } catch (e) {
    await prisma.recalcJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', error: String(e.message).slice(0, 500), finishedAt: new Date() },
    }).catch(() => {});
    throw e;
  }
}

/**
 * Recompute points for one match from its stored stats, honouring the current
 * point rule and any manual overrides. Never re-reads the feed, so a manual fix
 * survives a recalculation.
 */
export async function recalcMatchPoints(match) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: match.tournamentId }, include: { pointRule: true },
  });
  if (!tournament) return;

  const { resolveRule, computePoints, mvpScore } = await import('./statsEngine.js');
  const rule = resolveRule(tournament);

  const [teamStats, playerStats, penalties] = await Promise.all([
    prisma.teamStat.findMany({ where: { matchId: match.id } }),
    prisma.playerStat.findMany({ where: { matchId: match.id } }),
    prisma.penalty.findMany({ where: { matchId: match.id } }),
  ]);

  const penaltyByTeam = new Map();
  for (const p of penalties) penaltyByTeam.set(p.teamId, (penaltyByTeam.get(p.teamId) || 0) + Number(p.points || 0));

  await prisma.$transaction(async (tx) => {
    for (const s of teamStats) {
      const pts = computePoints(s.placement, s.kills, rule);
      const penalty = penaltyByTeam.get(s.teamId) || 0;
      await tx.teamStat.update({
        where: { id: s.id },
        data: { ...pts, isWWCD: s.placement === 1, penaltyPoints: penalty, adjustedPoints: pts.totalPoints - penalty },
      });
    }

    let best = null;
    for (const p of playerStats) {
      const score = mvpScore(p);
      await tx.playerStat.update({ where: { id: p.id }, data: { mvpScore: score, isMvp: false } });
      if (!best || score > best.score) best = { id: p.id, score };
    }
    if (best) await tx.playerStat.update({ where: { id: best.id }, data: { isMvp: true } });

    const winner = teamStats.find((s) => s.placement === 1);
    await tx.match.update({
      where: { id: match.id }, data: { winnerTeamId: winner ? winner.teamId : null },
    });
  }, { timeout: 30000 });
}

/** Mark aggregates stale without recomputing — cheap call after a small edit. */
export async function markStale(tournamentId) {
  await Promise.all([
    prisma.playerAggregate.updateMany({ where: { tournamentId }, data: { stale: true } }),
    prisma.teamAggregate.updateMany({ where: { tournamentId }, data: { stale: true } }),
  ]);
}
