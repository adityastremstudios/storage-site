import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import {
  Stat, StatCard, TeamCell, PlayerCell, Loading, ErrorBox, Filters, qs, ExportButtons,
} from '../components/StatBits.jsx';

const TABS = [
  { key: 'players', label: 'Player statistics' },
  { key: 'teams', label: 'Team statistics' },
  { key: 'records', label: 'Records' },
  { key: 'achievements', label: 'Achievements' },
];

export default function Statistics() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'players';
  const [tournaments, setTournaments] = useState([]);
  const [filters, setFilters] = useState({
    tournament: params.get('tournament') || '',
    sort: '', minMatches: '', minKills: '', country: '',
  });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recalcMsg, setRecalcMsg] = useState('');

  useEffect(() => {
    api.get('/tournaments?limit=100').then((r) => setTournaments(r.items || [])).catch(() => {});
  }, []);

  const query = useMemo(() => qs(filters), [filters]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true); setError(''); setData(null);
    const path = {
      players: `/stats/players${query}`,
      teams: `/stats/teams${query}`,
      records: `/stats/records${qs({ tournament: filters.tournament })}`,
      achievements: `/stats/achievements${qs({ tournament: filters.tournament })}`,
    }[tab];
    api.get(path)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [tab, query, filters.tournament]);

  const setTab = (key) => {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    setParams(next, { replace: true });
  };

  const recalc = async () => {
    if (!filters.tournament) { setRecalcMsg('Pick a tournament first'); return; }
    setRecalcMsg('Recalculating…');
    try {
      const r = await api.post('/stats/recalc', { tournamentId: Number(filters.tournament), scope: 'all' });
      setRecalcMsg(`Done — ${r.aggregates?.players ?? 0} player rows, ${r.records ?? 0} records, ${r.achievements ?? 0} achievements`);
      setFilters({ ...filters });
    } catch (e) { setRecalcMsg(e.message); }
  };

  return (
    <div className="page">
      <div className="topbar">
        <h1>Statistics Center</h1>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={recalc} disabled={busy}>Recalculate</button>
          <Link className="btn" to={`/stats/compare${qs({ tournament: filters.tournament })}`}>Compare</Link>
          {filters.tournament ? <Link className="btn" to={`/stats/caster/${filters.tournament}`}>Caster panel</Link> : null}
        </div>
      </div>

      {recalcMsg ? <div className="notice">{recalcMsg}</div> : null}

      <div className="tabbar">
        {TABS.map((t) => (
          <button key={t.key} className={`btn ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <Filters
        value={filters}
        onChange={setFilters}
        tournaments={tournaments}
        fields={tab === 'players' ? ['tournament', 'sort', 'minMatches', 'minKills', 'country']
          : tab === 'teams' ? ['tournament', 'sort', 'minMatches', 'country']
            : ['tournament']}
      />

      <ErrorBox error={error} />
      {busy ? <Loading /> : null}

      {!busy && tab === 'players' && <PlayerTable data={data} />}
      {!busy && tab === 'teams' && <TeamTable data={data} />}
      {!busy && tab === 'records' && <RecordList data={data} />}
      {!busy && tab === 'achievements' && <AchievementList data={data} />}
    </div>
  );
}

function PlayerTable({ data }) {
  const rows = data?.items || [];
  if (!rows.length) return <div className="empty">No player statistics yet. Import a match, then press Recalculate.</div>;
  const columns = [
    { label: 'Rank', key: 'rank' },
    { label: 'IGN', get: (r) => r.player?.ign },
    { label: 'Team', get: (r) => r.player?.currentTeam?.name || '' },
    { label: 'Matches', key: 'matches' },
    { label: 'Kills', key: 'kills' },
    { label: 'Damage', get: (r) => (r.provided?.includes('damage') ? r.damage : '') },
    { label: 'Assists', key: 'assists' },
    { label: 'Knocks', key: 'knocks' },
    { label: 'Headshots', key: 'headshots' },
    { label: 'Avg kills', key: 'avgKills' },
    { label: 'Avg damage', key: 'avgDamage' },
    { label: 'Avg placement', key: 'avgPlacement' },
    { label: 'MVP', key: 'mvpCount' },
    { label: 'WWCD', key: 'wwcdCount' },
  ];
  return (
    <div className="card">
      <div className="topbar">
        <span className="small mut">{data.total} players</span>
        <ExportButtons rows={rows} columns={columns} name="player-statistics" />
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th><th>Player</th><th>Team</th><th>M</th><th>Kills</th><th>Damage</th>
            <th>Assists</th><th>Knocks</th><th>HS</th><th>Avg K</th><th>Avg D</th>
            <th>Avg place</th><th>MVP</th><th>WWCD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.rank}</td>
              <td><PlayerCell player={r.player} /></td>
              <td><TeamCell team={r.player?.currentTeam} /></td>
              <td>{r.matches}</td>
              <td><strong><Stat value={r.kills} /></strong></td>
              <td><Stat value={r.provided?.includes('damage') ? r.damage : null} /></td>
              <td><Stat value={r.assists} /></td>
              <td><Stat value={r.knocks} /></td>
              <td><Stat value={r.headshots} /></td>
              <td><Stat value={r.avgKills} decimals={2} /></td>
              <td><Stat value={r.avgDamage} /></td>
              <td><Stat value={r.avgPlacement} decimals={2} /></td>
              <td>{r.mvpCount}</td>
              <td>{r.wwcdCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamTable({ data }) {
  const rows = data?.items || [];
  if (!rows.length) return <div className="empty">No team statistics yet. Import a match, then press Recalculate.</div>;
  const columns = [
    { label: 'Rank', key: 'rank' },
    { label: 'Team', get: (r) => r.team?.name },
    { label: 'Matches', key: 'matches' },
    { label: 'Points', key: 'points' },
    { label: 'Kills', key: 'kills' },
    { label: 'WWCD', key: 'wwcd' },
    { label: 'Avg placement', key: 'avgPlacement' },
    { label: 'Avg kills', key: 'avgKills' },
    { label: 'Avg damage', key: 'avgDamage' },
  ];
  return (
    <div className="card">
      <div className="topbar">
        <span className="small mut">{data.total} teams</span>
        <ExportButtons rows={rows} columns={columns} name="team-statistics" />
      </div>
      <table className="tbl">
        <thead>
          <tr><th>#</th><th>Team</th><th>M</th><th>Points</th><th>Kills</th><th>WWCD</th><th>Avg place</th><th>Avg K</th><th>Avg D</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.rank}</td>
              <td><TeamCell team={r.team} /></td>
              <td>{r.matches}</td>
              <td><strong><Stat value={r.points} decimals={1} /></strong></td>
              <td><Stat value={r.kills} /></td>
              <td>{r.wwcd}</td>
              <td><Stat value={r.avgPlacement} decimals={2} /></td>
              <td><Stat value={r.avgKills} decimals={2} /></td>
              <td><Stat value={r.avgDamage} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordList({ data }) {
  const rows = data?.items || [];
  if (!rows.length) return <div className="empty">No records yet. Press Recalculate after importing matches.</div>;
  return (
    <div className="grid3">
      {rows.map((r) => (
        <div className="card" key={r.id}>
          <div className="small mut">{r.label}</div>
          <div className="disp">{r.displayValue || r.value}</div>
          <div className="small">
            {r.player ? <PlayerCell player={r.player} /> : null}
            {r.team ? <TeamCell team={r.team} /> : null}
            {r.match ? <span className="mut"> · match #{r.match.matchNumber}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function AchievementList({ data }) {
  const rows = data?.items || [];
  if (!rows.length) return <div className="empty">No achievements unlocked yet.</div>;
  return (
    <div className="card">
      <table className="tbl">
        <thead><tr><th>Achievement</th><th>Player</th><th>Team</th><th>Value</th><th>Unlocked</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>
                <strong>{a.achievement?.name}</strong>
                {a.achievement?.tier ? <span className="badge">{a.achievement.tier}</span> : null}
                <div className="small mut">{a.achievement?.description}</div>
              </td>
              <td><PlayerCell player={a.player} /></td>
              <td className="mut">{a.player?.currentTeam?.name || '—'}</td>
              <td><Stat value={a.value} /></td>
              <td className="small mut">{new Date(a.unlockedAt).toLocaleDateString('en-IN')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
