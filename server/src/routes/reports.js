// Phase 19 — one-click exports: CSV / JSON for standings, fraggers, matches.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { toCSV } from '../utils/csv.js';
import { getStandings, getTopFraggers, COUNTED_STATUSES } from '../services/statsEngine.js';

const r = Router();

function send(res, format, filename, rows, columns) {
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(toCSV(rows, columns));
  }
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
  return res.json(rows);
}

r.get('/:slug/:type(overall|topfraggers|matches)', async (req, res, next) => {
  try {
    const t = await prisma.tournament.findFirst({ where: { slug: req.params.slug, deletedAt: null } });
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const { type } = req.params;

    if (type === 'overall') {
      const rows = await getStandings(t.id, req.query.round ? `round:${req.query.round}` : 'overall');
      return send(res, format, `${t.slug}-overall`, rows, [
        { key: 'rank', label: 'Rank' }, { key: (x) => x.team?.name, label: 'Team' },
        { key: 'matchesPlayed', label: 'Matches' }, { key: 'wwcd', label: 'WWCD' },
        { key: 'placementPoints', label: 'Placement Pts' }, { key: 'killPoints', label: 'Kill Pts' },
        { key: 'totalKills', label: 'Kills' }, { key: 'totalPoints', label: 'Total Pts' },
        { key: 'avgPlacement', label: 'Avg Placement' },
      ]);
    }
    if (type === 'topfraggers') {
      const rows = await getTopFraggers(t.id, 100);
      return send(res, format, `${t.slug}-topfraggers`, rows, [
        { key: 'rank', label: 'Rank' }, { key: (x) => x.player?.ign, label: 'Player' },
        { key: (x) => x.player?.currentTeam?.name, label: 'Team' }, { key: 'matches', label: 'Matches' },
        { key: 'kills', label: 'Kills' }, { key: 'damage', label: 'Damage' },
        { key: 'avgKills', label: 'Avg Kills' }, { key: 'avgDamage', label: 'Avg Damage' },
      ]);
    }
    const rows = await prisma.match.findMany({
      where: { tournamentId: t.id, deletedAt: null, status: { in: COUNTED_STATUSES } },
      orderBy: [{ roundId: 'asc' }, { matchNumber: 'asc' }],
      include: { round: true, map: true, winnerTeam: true },
    });
    return send(res, format, `${t.slug}-matches`, rows, [
      { key: (x) => x.round?.name, label: 'Round' }, { key: 'matchNumber', label: 'Match' },
      { key: (x) => x.map?.name, label: 'Map' }, { key: (x) => x.winnerTeam?.name, label: 'Winner' },
      { key: 'status', label: 'Status' }, { key: (x) => x.endedAt || '', label: 'Ended At' },
    ]);
  } catch (e) { next(e); }
});

export default r;
