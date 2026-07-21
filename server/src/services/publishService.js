// Live Publish Engine — bumps cache version + broadcasts refresh over sockets,
// and stores overlay JSON snapshots (overlay_outputs) on publish.
import { prisma } from '../lib/prisma.js';
import { bumpVersion } from '../lib/cache.js';
import { notifyRefresh } from '../lib/socket.js';
import { getStandings, getTopFraggers } from './statsEngine.js';

export async function bumpTournament(tournament, types = ['all']) {
  await bumpVersion(tournament.slug);
  notifyRefresh(tournament.slug, types);
}

export async function publishTournamentSnapshots(tournament, matchId = null) {
  try {
    const [overall, fraggers] = await Promise.all([
      getStandings(tournament.id, 'overall'),
      getTopFraggers(tournament.id, 10),
    ]);
    const snapshots = [
      { tournamentId: tournament.id, type: 'overall', data: JSON.parse(JSON.stringify(overall)) },
      { tournamentId: tournament.id, type: 'topfraggers', data: JSON.parse(JSON.stringify(fraggers)) },
    ];
    if (matchId) {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        include: { teamStats: { include: { team: true }, orderBy: { placement: 'asc' } }, map: true, round: true },
      });
      if (match) snapshots.push({ tournamentId: tournament.id, type: 'matchresult', data: JSON.parse(JSON.stringify(match)) });
    }
    await prisma.overlayOutput.createMany({ data: snapshots });
  } catch (e) {
    console.warn('[publish] snapshot failed', e.message);
  }
}

export async function publishMatch(matchId) {
  const match = await prisma.match.findUnique({ where: { id: matchId }, include: { tournament: true } });
  if (!match) return null;
  const updated = await prisma.match.update({ where: { id: matchId }, data: { status: 'PUBLISHED' } });
  const { recalcTournament } = await import('./statsEngine.js');
  await recalcTournament(match.tournamentId, [match.roundId]);
  await publishTournamentSnapshots(match.tournament, matchId);
  await bumpTournament(match.tournament);
  return updated;
}
