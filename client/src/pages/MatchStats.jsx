import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import {
  Stat, Duration, StatCard, TeamCell, PlayerCell, SourceBadge, Loading, ErrorBox, ExportButtons,
} from '../components/StatBits.jsx';

// ---------------------------------------------------------------------------
// Match statistics
// ---------------------------------------------------------------------------

export function MatchStats() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [versions, setVersions] = useState([]);
  const [tab, setTab] = useState('teams');

  const load = () => {
    setError('');
    api.get(`/stats/matches/${id}`).then(setData).catch((e) => setError(e.message));
    api.get(`/match-ops/${id}/versions`).then((r) => setVersions(r.items || [])).catch(() => {});
  };
  useEffect(load, [id]);

  const act = async (path, body) => {
    try { await api.post(`/match-ops/${id}${path}`, body); load(); }
    catch (e) { setError(e.message); }
  };

  if (error && !data) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;

  const { match, teamRanking, playerRanking, leaders, mvp, bestTeam, totals } = data;

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <h1>Match #{match.matchNumber}</h1>
          <div className="small mut">
            <Link to={`/tournaments/${match.tournament.id}`}>{match.tournament.name}</Link>
            {' · '}{match.round?.name}{match.map ? ` · ${match.map.name}` : ''}
            {' · '}<span className="badge">{match.status}</span>
            {match.isLocked ? <span className="badge">locked</span> : null}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {match.isLocked
            ? <button className="btn" onClick={() => act('/unlock')}>Unlock</button>
            : <button className="btn" onClick={() => act('/lock')}>Lock</button>}
          {match.status === 'PUBLISHED'
            ? <button className="btn" onClick={() => act('/unpublish')}>Unpublish</button>
            : <button className="btn" onClick={() => act('/publish')}>Publish</button>}
          <button className="btn" onClick={() => act('/recalc')}>Recalculate</button>
        </div>
      </div>

      <ErrorBox error={error} />

      <div className="stats">
        <StatCard label="Teams" value={totals.teams} />
        <StatCard label="Players" value={totals.players} />
        <StatCard label="Total kills" value={totals.kills} />
        <StatCard label="Total damage" value={totals.damage} />
      </div>

      <div className="grid2">
        <div className="card">
          <h3>MVP</h3>
          {mvp ? (
            <div>
              <div className="disp"><PlayerCell player={mvp.player} /></div>
              <div className="small mut"><TeamCell team={mvp.team} /> · {mvp.kills} kills · impact {mvp.mvpScore}</div>
            </div>
          ) : <div className="empty">No player stats</div>}
        </div>
        <div className="card">
          <h3>Best team</h3>
          {bestTeam ? (
            <div>
              <div className="disp"><TeamCell team={bestTeam.team} /></div>
              <div className="small mut">{bestTeam.points} points · {bestTeam.kills} kills</div>
            </div>
          ) : <div className="empty">No team stats</div>}
        </div>
      </div>

      <div className="tabbar">
        <button className={`btn ${tab === 'teams' ? 'on' : ''}`} onClick={() => setTab('teams')}>Team ranking</button>
        <button className={`btn ${tab === 'players' ? 'on' : ''}`} onClick={() => setTab('players')}>Player ranking</button>
        <button className={`btn ${tab === 'leaders' ? 'on' : ''}`} onClick={() => setTab('leaders')}>Leaderboards</button>
        <button className={`btn ${tab === 'versions' ? 'on' : ''}`} onClick={() => setTab('versions')}>Version history</button>
      </div>

      {tab === 'teams' && (
        <div className="card">
          <div className="topbar">
            <h3>Team ranking</h3>
            <ExportButtons
              rows={teamRanking}
              columns={[
                { label: 'Placement', key: 'placement' }, { label: 'Team', get: (r) => r.team?.name },
                { label: 'Kills', key: 'kills' }, { label: 'Damage', key: 'damage' },
                { label: 'Placement pts', key: 'placementPoints' }, { label: 'Kill pts', key: 'killPoints' },
                { label: 'Total', key: 'totalPoints' },
              ]}
              name={`match-${match.matchNumber}-teams`}
            />
          </div>
          <table className="tbl">
            <thead><tr><th>#</th><th>Team</th><th>Kills</th><th>Damage</th><th>Survival</th><th>Place pts</th><th>Kill pts</th><th>Total</th><th>Penalty</th></tr></thead>
            <tbody>
              {teamRanking.map((t) => (
                <tr key={t.team.id}>
                  <td>{t.placement}{t.isWWCD ? <span className="badge">WWCD</span> : null}</td>
                  <td><TeamCell team={t.team} /> <SourceBadge source={t.source} /></td>
                  <td><Stat value={t.kills} /></td>
                  <td><Stat value={t.damage} /></td>
                  <td><Duration seconds={t.survivalTime} /></td>
                  <td><Stat value={t.placementPoints} decimals={1} /></td>
                  <td><Stat value={t.killPoints} decimals={1} /></td>
                  <td><strong><Stat value={t.totalPoints} decimals={1} /></strong></td>
                  <td>{t.penaltyPoints ? <span className="err">-{t.penaltyPoints}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'players' && (
        <div className="card">
          <div className="topbar">
            <h3>Player ranking</h3>
            <ExportButtons
              rows={playerRanking}
              columns={[
                { label: 'Rank', key: 'rank' }, { label: 'Player', get: (r) => r.player?.ign },
                { label: 'Team', get: (r) => r.team?.name }, { label: 'Kills', key: 'kills' },
                { label: 'Damage', key: 'damage' }, { label: 'Assists', key: 'assists' },
                { label: 'Contribution %', key: 'contribution' },
              ]}
              name={`match-${match.matchNumber}-players`}
            />
          </div>
          <table className="tbl">
            <thead><tr><th>#</th><th>Player</th><th>Team</th><th>Kills</th><th>Damage</th><th>Assists</th><th>Knocks</th><th>HS</th><th>Revives</th><th>Survival</th><th>Share</th><th>Impact</th></tr></thead>
            <tbody>
              {playerRanking.map((p) => (
                <tr key={p.player.id}>
                  <td>{p.rank}{p.isMvp ? <span className="badge">MVP</span> : null}</td>
                  <td><PlayerCell player={p.player} /> <SourceBadge source={p.source} /></td>
                  <td><TeamCell team={p.team} /></td>
                  <td><strong><Stat value={p.kills} /></strong></td>
                  <td><Stat value={p.damage} /></td>
                  <td><Stat value={p.assists} /></td>
                  <td><Stat value={p.knocks} /></td>
                  <td><Stat value={p.headshots} /></td>
                  <td><Stat value={p.revives} /></td>
                  <td><Duration seconds={p.survivalTime} /></td>
                  <td><Stat value={p.contribution} decimals={1} suffix="%" /></td>
                  <td className="mut">{p.mvpScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'leaders' && (
        <div className="grid3">
          {Object.entries(leaders).map(([key, rows]) => (
            <div className="card" key={key}>
              <h3>{key.replace(/^top/, 'Top ').replace(/([A-Z])/g, ' $1').trim()}</h3>
              {rows.length ? (
                <table className="tbl">
                  <tbody>
                    {rows.slice(0, 5).map((r) => (
                      <tr key={r.player.id}>
                        <td>{r.rank}</td>
                        <td><PlayerCell player={r.player} /></td>
                        <td><strong><Stat value={r.value} /></strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="empty small">The feed does not supply this stat.</div>}
            </div>
          ))}
        </div>
      )}

      {tab === 'versions' && (
        <div className="card">
          <h3>Version history</h3>
          {versions.length ? (
            <table className="tbl">
              <thead><tr><th>Version</th><th>Source</th><th>Note</th><th>By</th><th>When</th><th></th></tr></thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>v{v.version}</td>
                    <td><span className="badge">{v.source}</span></td>
                    <td className="small mut">{v.note || '—'}</td>
                    <td className="small">{v.actor?.username || 'system'}</td>
                    <td className="small mut">{new Date(v.createdAt).toLocaleString('en-IN')}</td>
                    <td>
                      <button className="btn" onClick={() => act(`/versions/${v.version}/restore`, { reason: `Restore v${v.version}` })}>
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty">No versions recorded yet. The next import will create one.</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Caster panel
// ---------------------------------------------------------------------------

export function CasterPanel() {
  const { tournamentId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [auto, setAuto] = useState(true);

  const load = () => api.get(`/stats/caster/${tournamentId}`).then(setData).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    if (!auto) return undefined;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [tournamentId, auto]);

  if (error && !data) return <div className="page"><ErrorBox error={error} onRetry={load} /></div>;
  if (!data) return <div className="page"><Loading /></div>;

  const groups = data.insights.reduce((acc, i) => {
    (acc[i.category] ||= []).push(i.text);
    return acc;
  }, {});

  const copyAll = () => {
    const text = data.insights.map((i) => `• ${i.text}`).join('\n');
    navigator.clipboard?.writeText(text);
  };

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <h1>Caster panel</h1>
          <div className="small mut">
            Updated {new Date(data.generatedAt).toLocaleTimeString('en-IN')}
            {auto ? ' · refreshing every 30s' : ''}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => setAuto(!auto)}>{auto ? 'Pause refresh' : 'Resume refresh'}</button>
          <button className="btn" onClick={load}>Refresh now</button>
          <button className="btn" onClick={copyAll}>Copy all</button>
        </div>
      </div>

      {Object.keys(groups).length === 0 ? (
        <div className="empty">No insights yet — import and publish a match first.</div>
      ) : (
        <div className="grid2">
          {Object.entries(groups).map(([category, lines]) => (
            <div className="card" key={category}>
              <h3 style={{ textTransform: 'capitalize' }}>{category}</h3>
              <ul>
                {lines.map((line, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    {line}
                    <button
                      className="btn small"
                      style={{ marginLeft: 6 }}
                      onClick={() => navigator.clipboard?.writeText(line)}
                    >
                      copy
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
