import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import Modal, { Field } from '../components/Modal.jsx';
import MatchStatsEditor from '../components/MatchStatsEditor.jsx';
import { useAuth } from '../auth.jsx';

export default function TournamentDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [t, setT] = useState(null);
  const [tab, setTab] = useState('matches');
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  const reload = () => setTick((x) => x + 1);

  useEffect(() => { api.get(`/tournaments/${id}`).then(setT).catch((e) => setErr(e.message)); }, [id, tick]);

  if (err) return <div className="err">{err}</div>;
  if (!t) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="row" style={{ marginBottom: 6 }}>
        {t.logoUrl && <img src={t.logoUrl} alt="" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 8 }} />}
        <div>
          <div className="disp" style={{ fontSize: 26 }}>{t.name}</div>
          <div className="mut small">{t.game?.name} · <code className="k">{t.slug}</code> · rule: {t.pointRule?.name || 'Default'}</div>
        </div>
        <span className={`badge ${t.status === 'LIVE' ? 'live' : ''}`}>{t.status}</span>
        <div className="grow" />
        <a className="btn sm" href={`/?t=${t.slug}`} target="_blank" rel="noreferrer">Public page ↗</a>
      </div>
      <div className="tabbar">
        {['matches', 'standings', 'teams', 'rounds', 'overlays', 'exports'].map((x) => (
          <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{x}</button>
        ))}
      </div>
      {tab === 'teams' && <TeamsTab t={t} can={can} onChange={reload} />}
      {tab === 'rounds' && <RoundsTab t={t} can={can} onChange={reload} />}
      {tab === 'matches' && <MatchesTab t={t} can={can} onChange={reload} />}
      {tab === 'standings' && <StandingsTab t={t} />}
      {tab === 'overlays' && <OverlaysTab t={t} />}
      {tab === 'exports' && <ExportsTab t={t} />}
    </>
  );
}

function TeamsTab({ t, can, onChange }) {
  const [entries, setEntries] = useState([]);
  const [all, setAll] = useState([]);
  const [pick, setPick] = useState('');
  const load = () => api.get(`/tournaments/${t.id}/teams`).then((d) => setEntries(d.items));
  useEffect(() => { load(); api.get('/teams?limit=400').then((d) => setAll(d.items)); }, [t.id]);
  const registered = new Set(entries.map((e) => e.teamId));
  const add = async () => { if (pick) { await api.post(`/tournaments/${t.id}/teams`, { teamId: Number(pick) }); setPick(''); load(); onChange(); } };
  const rm = async (teamId) => { await api.del(`/tournaments/${t.id}/teams/${teamId}`); load(); onChange(); };
  return (
    <div className="card">
      <div className="chead"><h3>Registered teams ({entries.length})</h3><div className="grow" />
        {can('TOURNAMENT_MANAGER') && (
          <div className="row">
            <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ minWidth: 220 }}>
              <option value="">Add a team…</option>
              {all.filter((x) => !registered.has(x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <button className="btn sm primary" onClick={add}>Register</button>
          </div>
        )}
      </div>
      <table className="tbl">
        <thead><tr><th>Team</th><th>Roster</th><th style={{ width: 90 }} /></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{e.team.logoUrl && <img className="rowlogo" src={e.team.logoUrl} alt="" />}<b>{e.team.name}</b> <span className="mut small">{e.team.shortName}</span></td>
              <td className="mut small">{(e.team.currentPlayers || []).map((p) => p.ign).join(', ') || '—'}</td>
              <td style={{ textAlign: 'right' }}>{can('TOURNAMENT_MANAGER') && <button className="btn sm danger" onClick={() => rm(e.teamId)}>Remove</button>}</td>
            </tr>
          ))}
          {!entries.length && <tr><td colSpan={3} className="empty">No teams registered yet. Register teams here, or they auto-register on their first imported match.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function RoundsTab({ t, can, onChange }) {
  const [rounds, setRounds] = useState([]);
  const [name, setName] = useState('');
  const load = () => api.get(`/rounds?f_tournamentId=${t.id}&limit=100`).then((d) => setRounds(d.items));
  useEffect(() => { load(); }, [t.id]);
  const add = async () => {
    if (!name.trim()) return;
    await api.post('/rounds', { tournamentId: t.id, name: name.trim(), order: rounds.length + 1 });
    setName(''); load(); onChange();
  };
  const act = async (r, action) => { await api.post(`/rounds/${r.id}/${action}`, {}); load(); };
  const rm = async (r) => { if (confirm(`Delete round "${r.name}" and its matches?`)) { await api.del(`/rounds/${r.id}`); load(); onChange(); } };
  return (
    <div className="card">
      <div className="chead"><h3>Rounds</h3><div className="grow" />
        {can('TOURNAMENT_MANAGER') && (
          <div className="row">
            <input placeholder="e.g. Semi Finals" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} style={{ minWidth: 200 }} />
            <button className="btn sm primary" onClick={add}>Add round</button>
          </div>
        )}
      </div>
      <table className="tbl">
        <thead><tr><th>#</th><th>Round</th><th className="num">Matches</th><th>State</th><th style={{ width: 230 }} /></tr></thead>
        <tbody>
          {rounds.map((r) => (
            <tr key={r.id}>
              <td>{r.order}</td>
              <td><b>{r.name}</b></td>
              <td className="num">{r._count?.matches ?? 0}</td>
              <td>
                {r.isLocked && <span className="badge warn">Locked</span>}{' '}
                {r.isPublished ? <span className="badge ok">Published</span> : <span className="badge">Draft</span>}
              </td>
              <td style={{ textAlign: 'right' }}>
                {can('TOURNAMENT_MANAGER') && (<>
                  <button className="btn sm" onClick={() => act(r, r.isLocked ? 'unlock' : 'lock')}>{r.isLocked ? 'Unlock' : 'Lock'}</button>{' '}
                  {!r.isPublished && <button className="btn sm" onClick={() => act(r, 'publish')}>Publish</button>}{' '}
                  <button className="btn sm danger" onClick={() => rm(r)}>Delete</button>
                </>)}
              </td>
            </tr>
          ))}
          {!rounds.length && <tr><td colSpan={5} className="empty">No rounds yet — add "Round 1" to begin. Imports auto-create rounds too.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function MatchesTab({ t, can, onChange }) {
  const [matches, setMatches] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [maps, setMaps] = useState([]);
  const [entries, setEntries] = useState([]);
  const [create, setCreate] = useState(null);
  const [statsFor, setStatsFor] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api.get(`/matches?f_tournamentId=${t.id}&limit=300`).then((d) => setMatches(d.items));
  useEffect(() => {
    load();
    api.get(`/rounds?f_tournamentId=${t.id}&limit=100`).then((d) => setRounds(d.items));
    api.get(`/maps?f_gameId=${t.gameId}&limit=100`).then((d) => setMaps(d.items));
    api.get(`/tournaments/${t.id}/teams`).then((d) => setEntries(d.items));
  }, [t.id]);

  const saveMatch = async () => {
    setErr('');
    try {
      await api.post('/matches', { roundId: Number(create.roundId), mapId: create.mapId ? Number(create.mapId) : null, scheduledAt: create.scheduledAt || null, status: 'SCHEDULED' });
      setCreate(null); load(); onChange();
    } catch (e) { setErr(e.message); }
  };
  const act = async (m, action) => { try { await api.post(`/matches/${m.id}/${action}`, {}); load(); onChange(); } catch (e) { alert(e.message); } };
  const rm = async (m) => { if (confirm(`Delete match #${m.matchNumber}? (soft delete)`)) { await api.del(`/matches/${m.id}`); load(); onChange(); } };
  const badge = (s) => (s === 'PUBLISHED' ? 'ok' : s === 'LIVE' ? 'live' : s === 'LOCKED' ? 'warn' : '');

  return (
    <>
      <div className="card">
        <div className="chead"><h3>Matches</h3><div className="grow" />
          {can('DATA_ENTRY') && <button className="btn sm primary" onClick={() => setCreate({ roundId: rounds[0]?.id || '', mapId: '', scheduledAt: '' })}>Create match</button>}
        </div>
        <table className="tbl">
          <thead><tr><th>Round</th><th>Match</th><th>Map</th><th>Winner</th><th>Status</th><th style={{ width: 300 }} /></tr></thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id}>
                <td>{m.round?.name}</td>
                <td><b>#{m.matchNumber}</b></td>
                <td>{m.map?.name || '—'}</td>
                <td>{m.winnerTeam?.name || '—'}</td>
                <td><span className={`badge ${badge(m.status)}`}>{m.status}</span></td>
                <td style={{ textAlign: 'right' }}>
                  {can('DATA_ENTRY') && (<>
                    <button className="btn sm" onClick={() => setStatsFor(m)}>Enter stats</button>{' '}
                    {m.status === 'COMPLETED' && <button className="btn sm primary" onClick={() => act(m, 'publish')}>Publish</button>}{' '}
                    <button className="btn sm" onClick={() => act(m, m.isLocked ? 'unlock' : 'lock')}>{m.isLocked ? 'Unlock' : 'Lock'}</button>{' '}
                    <button className="btn sm danger" onClick={() => rm(m)}>Delete</button>
                  </>)}
                </td>
              </tr>
            ))}
            {!matches.length && <tr><td colSpan={6} className="empty">No matches yet — create one and enter stats, or push JSON to /api/import/match.</td></tr>}
          </tbody>
        </table>
      </div>
      {create && (
        <Modal title="Create match" onClose={() => setCreate(null)}
          footer={<><button className="btn" onClick={() => setCreate(null)}>Cancel</button><button className="btn primary" onClick={saveMatch}>Create match</button></>}>
          {err && <div className="err">{err}</div>}
          <Field label="Round">
            <select value={create.roundId} onChange={(e) => setCreate({ ...create, roundId: e.target.value })}>
              {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Map">
            <select value={create.mapId} onChange={(e) => setCreate({ ...create, mapId: e.target.value })}>
              <option value="">—</option>
              {maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="Scheduled time"><input type="datetime-local" value={create.scheduledAt} onChange={(e) => setCreate({ ...create, scheduledAt: e.target.value })} /></Field>
          {!rounds.length && <div className="err">Create a round first (Rounds tab).</div>}
        </Modal>
      )}
      {statsFor && (
        <MatchStatsEditor match={statsFor} entries={entries}
          onClose={() => setStatsFor(null)}
          onSaved={() => { setStatsFor(null); load(); onChange(); }} />
      )}
    </>
  );
}

function StandingsTab({ t }) {
  const [items, setItems] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [round, setRound] = useState('');
  const [busy, setBusy] = useState(false);
  const load = (recalc) => {
    setBusy(true);
    api.get(`/tournaments/${t.id}/standings?${round ? `round=${round}&` : ''}${recalc ? 'recalc=1' : ''}`)
      .then((d) => setItems(d.items)).finally(() => setBusy(false));
  };
  useEffect(() => { load(false); }, [t.id, round]);
  useEffect(() => { api.get(`/rounds?f_tournamentId=${t.id}&limit=100`).then((d) => setRounds(d.items)); }, [t.id]);
  return (
    <div className="card">
      <div className="chead"><h3>Standings</h3>
        <select value={round} onChange={(e) => setRound(e.target.value)} style={{ width: 180 }}>
          <option value="">Overall</option>
          {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <div className="grow" />
        <button className="btn sm" disabled={busy} onClick={() => load(true)}>{busy ? 'Working…' : 'Recalculate'}</button>
      </div>
      <table className="tbl">
        <thead><tr><th>#</th><th>Team</th><th className="num">M</th><th className="num">WWCD</th><th className="num">Place pts</th><th className="num">Elims</th><th className="num">Avg place</th><th className="num">Total</th></tr></thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td>{r.rank}</td>
              <td>{r.team?.logoUrl && <img className="rowlogo" src={r.team.logoUrl} alt="" />}<b>{r.team?.name}</b></td>
              <td className="num">{r.matchesPlayed}</td>
              <td className="num">{r.wwcd}</td>
              <td className="num">{r.placementPoints}</td>
              <td className="num">{r.totalKills}</td>
              <td className="num">{r.avgPlacement}</td>
              <td className="num pts">{r.totalPoints}</td>
            </tr>
          ))}
          {!items.length && <tr><td colSpan={8} className="empty">No standings yet — publish a match first.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function OverlaysTab({ t }) {
  const [links, setLinks] = useState([]);
  useEffect(() => { api.get(`/tournaments/${t.id}/overlay-links`).then((d) => setLinks(d.items)); }, [t.id]);
  const copy = (url, e) => { navigator.clipboard.writeText(url); e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1200); };
  return (
    <div className="card">
      <div className="chead"><h3>OBS / vMix browser sources</h3><div className="grow" /><span className="mut small">1920×1080 · refresh instantly on publish</span></div>
      <table className="tbl">
        <thead><tr><th style={{ width: 140 }}>Overlay</th><th>URL</th><th style={{ width: 150 }} /></tr></thead>
        <tbody>
          {links.map((l) => (
            <tr key={l.type}>
              <td><span className="badge warn">{l.type}</span></td>
              <td><code className="k" style={{ fontSize: 11.5 }}>{l.url}</code></td>
              <td style={{ textAlign: 'right' }}>
                <a className="btn sm" href={`${l.url}&bg=dark`} target="_blank" rel="noreferrer">Preview</a>{' '}
                <button className="btn sm" onClick={(e) => copy(l.url, e)}>Copy</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cbody mut small">Optional params: <code className="k">&bg=green</code> chroma key · <code className="k">&bg=dark</code> preview · <code className="k">&accent=%23FF5722</code> brand colour · <code className="k">&round=ID</code> per-round.</div>
    </div>
  );
}

function ExportsTab({ t }) {
  const items = [
    ['Overall standings', `/api/reports/${t.slug}/overall`],
    ['Top fraggers', `/api/reports/${t.slug}/topfraggers`],
    ['Match list', `/api/reports/${t.slug}/matches`],
  ];
  return (
    <div className="card">
      <div className="chead"><h3>Reports & exports</h3></div>
      <table className="tbl">
        <thead><tr><th>Report</th><th style={{ width: 220 }} /></tr></thead>
        <tbody>
          {items.map(([label, url]) => (
            <tr key={url}>
              <td><b>{label}</b></td>
              <td style={{ textAlign: 'right' }}>
                <a className="btn sm" href={`${url}?format=csv`}>Download CSV</a>{' '}
                <a className="btn sm" href={url} target="_blank" rel="noreferrer">JSON</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cbody mut small">CSV opens directly in Excel / Google Sheets. The same data is available live at <code className="k">/api/public/t/{t.slug}/…</code> for any external tool.</div>
    </div>
  );
}
