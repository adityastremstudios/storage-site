import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal, { Field } from '../components/Modal.jsx';

const BLANK = {
  name: '', url: '', adapter: 'auto', tournamentId: '', roundName: '', mapName: '',
  intervalSec: 20, importWhen: 'finished', killField: 'auto', autoPublish: true, isActive: true, minTeams: 2,
};

const STATUS = {
  imported: 'ok', unchanged: '', waiting: 'warn', skipped: 'warn', locked: 'warn', error: 'danger',
};

export default function Feeds() {
  const [items, setItems] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [adapters, setAdapters] = useState([]);
  const [edit, setEdit] = useState(null);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const [logs, setLogs] = useState(null);
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState('');

  const load = () => api.get('/feeds').then((d) => setItems(d.items)).catch((e) => setErr(e.message));

  useEffect(() => {
    load();
    api.get('/tournaments?limit=200').then((d) => setTournaments(d.items)).catch(() => {});
    api.get('/feeds/adapters').then((d) => setAdapters(d.items)).catch(() => {});
    const t = setInterval(load, 8000); // keep the status column live
    return () => clearInterval(t);
  }, []);

  const save = async () => {
    setErr('');
    const body = {
      ...edit,
      tournamentId: Number(edit.tournamentId),
      intervalSec: Number(edit.intervalSec) || 20,
      minTeams: Number(edit.minTeams) || 2,
      roundName: edit.roundName || null,
      mapName: edit.mapName || null,
    };
    delete body.id; delete body.tournament; delete body.round; delete body.logs;
    try {
      if (edit.id) await api.patch(`/feeds/${edit.id}`, body);
      else await api.post('/feeds', body);
      setEdit(null); setTest(null); load();
    } catch (e) { setErr(e.message); }
  };

  const runTest = async () => {
    setErr(''); setTesting(true); setTest(null);
    try {
      setTest(await api.post('/feeds/test', { url: edit.url, adapter: edit.adapter, killField: edit.killField }));
    } catch (e) { setErr(e.message); }
    setTesting(false);
  };

  const act = async (id, fn) => {
    setBusy(id); setErr('');
    try { await fn(); } catch (e) { setErr(e.message); }
    setBusy(0); load();
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="mut small">
          Feeds <b>pull</b> data: UETMS polls your scoreboard URL on a timer, converts it and runs the same
          import pipeline — match, stats, standings and overlays update on their own.
        </span>
        <div className="grow" />
        <button className="btn primary" onClick={() => { setEdit({ ...BLANK }); setTest(null); }}>New feed</button>
      </div>
      {err && !edit && <div className="err">{err}</div>}

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Feed</th><th>Tournament</th><th>Every</th><th>Status</th>
              <th className="num">Imports</th><th style={{ width: 230 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((f) => (
              <tr key={f.id}>
                <td>
                  <b>{f.name}</b> {f.isActive ? <span className="badge live">running</span> : <span className="badge">paused</span>}
                  <div className="mut small" style={{ wordBreak: 'break-all' }}>{f.url}</div>
                </td>
                <td>{f.tournament?.name}<div className="mut small">{f.roundName || f.round?.name || 'latest round'} · {f.importWhen === 'finished' ? 'on match end' : 'every change'}</div></td>
                <td className="mut small">{f.intervalSec}s</td>
                <td>
                  {f.lastStatus
                    ? <span className={`badge ${STATUS[f.lastStatus] ?? ''}`}>{f.lastStatus}</span>
                    : <span className="mut small">not run yet</span>}
                  <div className="mut small">{f.lastMessage}</div>
                  <div className="mut small">{f.lastRunAt ? new Date(f.lastRunAt).toLocaleTimeString() : ''}</div>
                </td>
                <td className="num">{f.imports}{f.errors ? <span className="mut small"> / {f.errors} err</span> : null}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn sm" disabled={busy === f.id} onClick={() => act(f.id, () => api.post(`/feeds/${f.id}/run`))}>Run now</button>{' '}
                  <button className="btn sm" disabled={busy === f.id} onClick={() => act(f.id, () => api.post(`/feeds/${f.id}/toggle`))}>{f.isActive ? 'Pause' : 'Start'}</button>{' '}
                  <button className="btn sm" onClick={() => api.get(`/feeds/${f.id}/logs`).then((d) => setLogs({ feed: f, items: d.items }))}>Logs</button>{' '}
                  <button className="btn sm" onClick={() => { setEdit({ ...f, tournamentId: String(f.tournamentId), roundName: f.roundName || '', mapName: f.mapName || '' }); setTest(null); }}>Edit</button>{' '}
                  <button className="btn sm danger" onClick={() => window.confirm(`Delete feed "${f.name}"?`) && act(f.id, () => api.del(`/feeds/${f.id}`))}>Delete</button>
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} className="empty">No feeds yet — add your scoreboard URL and UETMS will read it automatically.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal
          wide
          title={edit.id ? 'Edit feed' : 'New feed'}
          onClose={() => { setEdit(null); setTest(null); }}
          footer={<>
            <button className="btn" onClick={runTest} disabled={!edit.url || testing}>{testing ? 'Testing…' : 'Test feed'}</button>
            <div className="grow" />
            <button className="btn" onClick={() => { setEdit(null); setTest(null); }}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={!edit.name || !edit.url || !edit.tournamentId}>Save</button>
          </>}
        >
          {err && <div className="err">{err}</div>}
          <Field label="Name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Main site live scoreboard" /></Field>
          <Field label="Feed URL (must return JSON)">
            <input value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} placeholder="https://tochanparn.space/api/final-data" />
          </Field>
          <div className="grid2">
            <Field label="Tournament">
              <select value={edit.tournamentId} onChange={(e) => setEdit({ ...edit, tournamentId: e.target.value })}>
                <option value="">Select…</option>
                {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Round (name — created if missing)">
              <input value={edit.roundName} onChange={(e) => setEdit({ ...edit, roundName: e.target.value })} placeholder="Day 1 (blank = latest round)" />
            </Field>
            <Field label="Format">
              <select value={edit.adapter} onChange={(e) => setEdit({ ...edit, adapter: e.target.value })}>
                <option value="auto">Auto-detect</option>
                {adapters.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </Field>
            <Field label="Map (optional)">
              <input value={edit.mapName} onChange={(e) => setEdit({ ...edit, mapName: e.target.value })} placeholder="Erangel" />
            </Field>
            <Field label="Check every (seconds)">
              <input type="number" min={5} value={edit.intervalSec} onChange={(e) => setEdit({ ...edit, intervalSec: e.target.value })} />
            </Field>
            <Field label="Import when">
              <select value={edit.importWhen} onChange={(e) => setEdit({ ...edit, importWhen: e.target.value })}>
                <option value="finished">Match finished (1 team left)</option>
                <option value="always">Every change (live standings)</option>
              </select>
            </Field>
            <Field label="Player kills come from">
              <select value={edit.killField} onChange={(e) => setEdit({ ...edit, killField: e.target.value })}>
                <option value="auto">Auto-detect (recommended)</option>
                <option value="knock">knockCount</option>
                <option value="elim">elimCount</option>
                <option value="sum">knockCount + elimCount</option>
              </select>
            </Field>
            <Field label="Minimum teams required">
              <input type="number" min={2} value={edit.minTeams} onChange={(e) => setEdit({ ...edit, minTeams: e.target.value })} />
            </Field>
          </div>
          <div className="row" style={{ gap: 18, marginTop: 6 }}>
            <label className="row" style={{ gap: 7 }}>
              <input type="checkbox" checked={edit.autoPublish} onChange={(e) => setEdit({ ...edit, autoPublish: e.target.checked })} />
              <span>Publish automatically (pushes to overlays + public site)</span>
            </label>
            <label className="row" style={{ gap: 7 }}>
              <input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />
              <span>Start polling immediately</span>
            </label>
          </div>

          {test && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="chead">
                <h3>Preview — nothing has been saved</h3>
                <div className="grow" />
                <span className="mut small">
                  {test.adapter} · kills from <b>{test.killField}</b> · {test.teamCount} teams · {test.playerCount} players · {test.totalKills} kills · {test.ms}ms
                </span>
              </div>
              <div className="cbody">
                <div className="row" style={{ gap: 10, marginBottom: 10 }}>
                  {test.finished
                    ? <span className="badge ok">match finished — ready to import</span>
                    : <span className="badge warn">still live — {test.aliveTeams} teams alive</span>}
                  <span className="mut small">match id: <code className="k">{test.externalMatchId || '(auto-generated)'}</code></span>
                </div>
                <table className="tbl">
                  <thead><tr><th style={{ width: 40 }}>#</th><th>Team</th><th className="num">Kills</th><th>Players</th></tr></thead>
                  <tbody>
                    {test.teams.map((t) => (
                      <tr key={t.placement}>
                        <td><b>{t.placement}</b></td>
                        <td>{t.team} {t.shortName && <span className="mut small">({t.shortName})</span>}</td>
                        <td className="num">{t.kills}</td>
                        <td className="mut small">{(t.players || []).map((p) => `${p.ign} ${p.kills}`).join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Modal>
      )}

      {logs && (
        <Modal wide title={`Activity — ${logs.feed.name}`} onClose={() => setLogs(null)}
          footer={<button className="btn" onClick={() => setLogs(null)}>Close</button>}>
          <table className="tbl">
            <thead><tr><th style={{ width: 170 }}>Time</th><th style={{ width: 110 }}>Status</th><th>Message</th></tr></thead>
            <tbody>
              {logs.items.map((l) => (
                <tr key={l.id}>
                  <td className="mut small">{new Date(l.createdAt).toLocaleString()}</td>
                  <td><span className={`badge ${STATUS[l.status] ?? ''}`}>{l.status}</span></td>
                  <td className="small">{l.message}</td>
                </tr>
              ))}
              {!logs.items.length && <tr><td colSpan={3} className="empty">Nothing logged yet.</td></tr>}
            </tbody>
          </table>
        </Modal>
      )}
    </>
  );
}
