import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/dashboard').then(setData).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="err">{err}</div>;
  if (!data) return <div className="empty">Loading…</div>;
  const c = data.counts;
  return (
    <>
      <div className="stats">
        {[['Tournaments', c.tournaments], ['Teams', c.teams], ['Players', c.players], ['Matches', c.matches], ['Users', c.users]].map(([l, v]) => (
          <div className="stat" key={l}><div className="v">{v}</div><div className="l">{l}</div></div>
        ))}
      </div>
      {data.live.length > 0 && (
        <div className="card">
          <div className="chead"><h3>Live now</h3></div>
          <div className="cbody row">
            {data.live.map((t) => (
              <Link key={t.id} to={`/tournaments/${t.id}`} className="btn">
                <span className="badge live">LIVE</span> {t.name} <span className="mut small">{t.game?.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      <div className="card">
        <div className="chead"><h3>Recent matches</h3><div className="grow" /><span className="mut small">Cache: {data.cache?.backend}</span></div>
        <table className="tbl">
          <thead><tr><th>Tournament</th><th>Round</th><th>Match</th><th>Winner</th><th>Status</th></tr></thead>
          <tbody>
            {data.recentMatches.map((m) => (
              <tr key={m.id}>
                <td>{m.tournament?.name}</td>
                <td>{m.round?.name}</td>
                <td>#{m.matchNumber}</td>
                <td>{m.winnerTeam?.name || '—'}</td>
                <td><span className={`badge ${m.status === 'PUBLISHED' ? 'ok' : m.status === 'LIVE' ? 'live' : ''}`}>{m.status}</span></td>
              </tr>
            ))}
            {!data.recentMatches.length && <tr><td colSpan={5} className="empty">No matches yet — create a tournament to get started.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
