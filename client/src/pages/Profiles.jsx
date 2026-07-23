import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import {
  Stat, Duration, StatCard, TeamCell, PlayerCell, Loading, ErrorBox, qs, ExportButtons,
} from '../components/StatBits.jsx';

// ---------------------------------------------------------------------------
// Player profile
// ---------------------------------------------------------------------------

export function PlayerProfile() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const tournament = params.get('tournament') || '';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    api.get(`/stats/players/${id}${qs({ tournament })}`)
      .then(setData).catch((e) => setError(e.message));
  }, [id, tournament]);

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;

  const { player, stats, recentMatches, achievements, bestMatch, worstMatch } = data;

  return (
    <div className="page">
      <div className="topbar">
        <div className="rowlogo">
          {player.photoUrl ? <img src={player.photoUrl} alt="" width="48" height="48" /> : null}
          <div>
            <h1>{player.ign}</h1>
            <div className="small mut">
              {[player.realName, player.country, player.role].filter(Boolean).join(' · ') || 'No profile details yet'}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <TeamCell team={player.currentTeam} />
          <Link className="btn" to={`/stats/compare?ids=${player.id}${tournament ? `&tournament=${tournament}` : ''}`}>Compare</Link>
        </div>
      </div>

      <div className="stats">
        <StatCard label="Matches" value={stats.matches} />
        <StatCard label="Kills" value={stats.kills} />
        <StatCard label="Damage" value={stats.provided?.includes('damage') ? stats.damage : null} />
        <StatCard label="Assists" value={stats.assists} />
        <StatCard label="Knocks" value={stats.knocks} />
        <StatCard label="Headshots" value={stats.headshots} />
        <StatCard label="Revives" value={stats.revives} />
        <StatCard label="Avg kills" value={stats.avgKills} decimals={2} />
        <StatCard label="Avg damage" value={stats.avgDamage} />
        <StatCard label="Avg placement" value={stats.avgPlacement} decimals={2} />
        <StatCard label="MVP" value={stats.mvpCount} />
        <StatCard label="WWCD" value={stats.wwcdCount} />
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Best match</h3>
          {bestMatch ? (
            <div>
              <Link to={`/stats/matches/${bestMatch.matchId}`}>Match #{bestMatch.matchNumber}</Link>
              <div className="small mut">{[bestMatch.map, bestMatch.round, bestMatch.tournament?.name].filter(Boolean).join(' · ')}</div>
              <div className="disp"><Stat value={bestMatch.kills} /> kills</div>
              <div className="small">Damage <Stat value={bestMatch.damage} /> · impact {bestMatch.mvpScore}</div>
            </div>
          ) : <div className="empty">No matches yet</div>}
        </div>
        <div className="card">
          <h3>Worst match</h3>
          {worstMatch ? (
            <div>
              <Link to={`/stats/matches/${worstMatch.matchId}`}>Match #{worstMatch.matchNumber}</Link>
              <div className="small mut">{[worstMatch.map, worstMatch.round].filter(Boolean).join(' · ')}</div>
              <div className="disp"><Stat value={worstMatch.kills} /> kills</div>
              <div className="small">Impact {worstMatch.mvpScore}</div>
            </div>
          ) : <div className="empty">No matches yet</div>}
        </div>
      </div>

      {achievements?.length ? (
        <div className="card">
          <h3>Achievements</h3>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {achievements.map((a) => (
              <span className="badge" key={a.id} title={a.achievement?.description}>
                {a.achievement?.name}{a.value ? ` · ${Math.round(a.value)}` : ''}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="topbar">
          <h3>Recent matches</h3>
          <ExportButtons
            rows={recentMatches}
            columns={[
              { label: 'Match', key: 'matchNumber' }, { label: 'Map', key: 'map' },
              { label: 'Placement', key: 'placement' }, { label: 'Kills', key: 'kills' },
              { label: 'Damage', key: 'damage' }, { label: 'Contribution %', key: 'contribution' },
            ]}
            name={`${player.ign}-recent-matches`}
          />
        </div>
        {recentMatches.length ? (
          <table className="tbl">
            <thead>
              <tr><th>Match</th><th>Map</th><th>Team</th><th>Place</th><th>Kills</th><th>Damage</th><th>Assists</th><th>Survival</th><th>Share</th><th>MVP</th></tr>
            </thead>
            <tbody>
              {recentMatches.map((m) => (
                <tr key={m.matchId}>
                  <td><Link to={`/stats/matches/${m.matchId}`}>#{m.matchNumber}</Link></td>
                  <td className="mut">{m.map || '—'}</td>
                  <td><TeamCell team={m.team} /></td>
                  <td>{m.placement ? `#${m.placement}` : '—'}{m.isWWCD ? <span className="badge">WWCD</span> : null}</td>
                  <td><strong><Stat value={m.kills} /></strong></td>
                  <td><Stat value={m.damage} /></td>
                  <td><Stat value={m.assists} /></td>
                  <td><Duration seconds={m.survivalTime} /></td>
                  <td><Stat value={m.contribution} decimals={1} suffix="%" /></td>
                  <td>{m.isMvp ? <span className="badge">MVP</span> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">No matches recorded yet.</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team profile
// ---------------------------------------------------------------------------

export function TeamProfile() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const tournament = params.get('tournament') || '';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    api.get(`/stats/teams/${id}${qs({ tournament })}`)
      .then(setData).catch((e) => setError(e.message));
  }, [id, tournament]);

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;

  const { team, stats, roster, recentMatches } = data;

  return (
    <div className="page">
      <div className="topbar">
        <div className="rowlogo">
          {team.logoUrl ? <img src={team.logoUrl} alt="" width="48" height="48" /> : null}
          <div>
            <h1>{team.name}</h1>
            <div className="small mut">
              {[team.country, team.coach ? `Coach: ${team.coach}` : null, team.organization?.name].filter(Boolean).join(' · ') || 'No profile details yet'}
            </div>
          </div>
        </div>
        <Link className="btn" to={`/stats/compare?type=teams&ids=${team.id}${tournament ? `&tournament=${tournament}` : ''}`}>Compare</Link>
      </div>

      <div className="stats">
        <StatCard label="Matches" value={stats.matches} />
        <StatCard label="Points" value={stats.points} decimals={1} />
        <StatCard label="Kills" value={stats.kills} />
        <StatCard label="Damage" value={stats.provided?.includes('damage') ? stats.damage : null} />
        <StatCard label="WWCD" value={stats.wwcd} />
        <StatCard label="Avg placement" value={stats.avgPlacement} decimals={2} />
        <StatCard label="Avg kills" value={stats.avgKills} decimals={2} />
        <StatCard label="Avg damage" value={stats.avgDamage} />
      </div>

      <div className="card">
        <h3>Roster</h3>
        {roster?.length ? (
          <table className="tbl">
            <thead><tr><th>Player</th><th>Role</th><th>M</th><th>Kills</th><th>Damage</th><th>Avg K</th><th>MVP</th><th>Share</th></tr></thead>
            <tbody>
              {roster.map((p) => (
                <tr key={p.id}>
                  <td><PlayerCell player={p.player} /></td>
                  <td className="mut">{p.player?.role || '—'}</td>
                  <td>{p.matches}</td>
                  <td><strong><Stat value={p.kills} /></strong></td>
                  <td><Stat value={p.provided?.includes('damage') ? p.damage : null} /></td>
                  <td><Stat value={p.avgKills} decimals={2} /></td>
                  <td>{p.mvpCount}</td>
                  <td><Stat value={stats.kills ? (p.kills / stats.kills) * 100 : null} decimals={1} suffix="%" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">No roster statistics yet.</div>}
      </div>

      <div className="card">
        <h3>Recent matches</h3>
        {recentMatches?.length ? (
          <table className="tbl">
            <thead><tr><th>Match</th><th>Map</th><th>Place</th><th>Kills</th><th>Damage</th><th>Points</th><th>Penalty</th></tr></thead>
            <tbody>
              {recentMatches.map((m) => (
                <tr key={m.matchId}>
                  <td><Link to={`/stats/matches/${m.matchId}`}>#{m.matchNumber}</Link></td>
                  <td className="mut">{m.map || '—'}</td>
                  <td>#{m.placement}{m.isWWCD ? <span className="badge">WWCD</span> : null}</td>
                  <td><Stat value={m.kills} /></td>
                  <td><Stat value={m.damage} /></td>
                  <td><strong><Stat value={m.points} decimals={1} /></strong></td>
                  <td>{m.penaltyPoints ? <span className="err">-{m.penaltyPoints}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">No matches recorded yet.</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison — players or teams, two to four at a time
// ---------------------------------------------------------------------------

const PLAYER_METRICS = [
  ['matches', 'Matches'], ['kills', 'Kills'], ['damage', 'Damage'], ['assists', 'Assists'],
  ['knocks', 'Knocks'], ['headshots', 'Headshots'], ['revives', 'Revives'],
  ['avgKills', 'Avg kills'], ['avgDamage', 'Avg damage'], ['avgPlacement', 'Avg placement'],
  ['avgSurvival', 'Avg survival'], ['mvpCount', 'MVP'], ['wwcdCount', 'WWCD'],
];
const TEAM_METRICS = [
  ['matches', 'Matches'], ['points', 'Points'], ['kills', 'Kills'], ['damage', 'Damage'],
  ['wwcd', 'WWCD'], ['avgPlacement', 'Avg placement'], ['avgKills', 'Avg kills'],
  ['avgDamage', 'Avg damage'], ['avgSurvival', 'Avg survival'],
];

export function Compare() {
  const [params, setParams] = useSearchParams();
  const type = params.get('type') === 'teams' ? 'teams' : 'players';
  const tournament = params.get('tournament') || '';
  const ids = (params.get('ids') || '').split(',').filter(Boolean);

  const [options, setOptions] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const path = type === 'teams' ? '/teams?limit=300' : '/players?limit=500';
    api.get(path).then((r) => setOptions(r.items || [])).catch(() => {});
  }, [type]);

  useEffect(() => {
    if (ids.length < 2) { setData(null); return; }
    setError('');
    api.get(`/stats/${type}/compare${qs({ ids: ids.join(','), tournament })}`)
      .then(setData).catch((e) => setError(e.message));
  }, [type, ids.join(','), tournament]);

  const update = (next) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k); }
    setParams(p, { replace: true });
  };

  const pick = (index, value) => {
    const next = [...ids];
    if (value) next[index] = value; else next.splice(index, 1);
    update({ ids: next.filter(Boolean).join(',') });
  };

  const metrics = type === 'teams' ? TEAM_METRICS : PLAYER_METRICS;
  const rows = type === 'teams' ? data?.teams : data?.players;
  const label = (r) => (type === 'teams' ? r.team?.name : r.player?.ign);

  return (
    <div className="page">
      <div className="topbar">
        <h1>Comparison</h1>
        <div className="row" style={{ gap: 8 }}>
          <button className={`btn ${type === 'players' ? 'on' : ''}`} onClick={() => update({ type: '', ids: '' })}>Players</button>
          <button className={`btn ${type === 'teams' ? 'on' : ''}`} onClick={() => update({ type: 'teams', ids: '' })}>Teams</button>
        </div>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {[0, 1, 2, 3].map((i) => (
          <select key={i} value={ids[i] || ''} onChange={(e) => pick(i, e.target.value)}>
            <option value="">{i < 2 ? `Select ${type === 'teams' ? 'team' : 'player'} ${i + 1}` : 'Add another (optional)'}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{type === 'teams' ? o.name : o.ign}</option>
            ))}
          </select>
        ))}
      </div>

      <ErrorBox error={error} />

      {ids.length < 2 ? (
        <div className="empty">Pick at least two to compare.</div>
      ) : !data ? <Loading /> : (
        <>
          <div className="card">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Metric</th>
                  {rows.map((r, i) => <th key={i}>{label(r)}</th>)}
                </tr>
              </thead>
              <tbody>
                {metrics.map(([key, name]) => (
                  <tr key={key}>
                    <td className="mut">{name}</td>
                    {rows.map((r, i) => {
                      const v = r.stats?.[key];
                      const isWinner = data.winners?.[key] && data.winners[key] === (type === 'teams' ? r.team?.id : r.player?.id);
                      return (
                        <td key={i}>
                          {isWinner ? <strong><Stat value={v} decimals={key.startsWith('avg') ? 2 : 0} /></strong>
                            : <Stat value={v} decimals={key.startsWith('avg') ? 2 : 0} />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Trend</h3>
            <TrendChart rows={rows} label={label} field={type === 'teams' ? 'cumulative' : 'kills'} />
          </div>
        </>
      )}
    </div>
  );
}

/** Inline SVG sparkline — no chart dependency, prints cleanly to PDF. */
function TrendChart({ rows, label, field }) {
  const series = rows.map((r) => ({ name: label(r), points: (r.trend || []).map((p) => Number(p[field] ?? 0)) }));
  const maxLen = Math.max(0, ...series.map((s) => s.points.length));
  const maxVal = Math.max(1, ...series.flatMap((s) => s.points));
  if (!maxLen) return <div className="empty">Not enough match data to draw a trend.</div>;

  const W = 640; const H = 180; const pad = 24;
  const x = (i) => pad + (maxLen > 1 ? (i * (W - pad * 2)) / (maxLen - 1) : 0);
  const y = (v) => H - pad - (v / maxVal) * (H - pad * 2);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="180" role="img" aria-label="Trend comparison">
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="currentColor" opacity="0.2" />
        <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="currentColor" opacity="0.2" />
        {series.map((s, si) => (
          <polyline
            key={si}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            opacity={1 - si * 0.25}
            strokeDasharray={si === 0 ? '' : `${4 + si * 2} ${3 + si}`}
            points={s.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
          />
        ))}
      </svg>
      <div className="row small" style={{ gap: 12, flexWrap: 'wrap' }}>
        {series.map((s, i) => <span key={i} className="mut">{i === 0 ? '——' : '- -'} {s.name}</span>)}
      </div>
    </div>
  );
}
