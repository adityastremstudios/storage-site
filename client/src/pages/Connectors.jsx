import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal, { Field } from '../components/Modal.jsx';

export default function Connectors() {
  const [items, setItems] = useState([]);
  const [games, setGames] = useState([]);
  const [create, setCreate] = useState(null);
  const [created, setCreated] = useState(null);
  const [sample, setSample] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api.get('/connectors?limit=200').then((d) => setItems(d.items)).catch((e) => setErr(e.message));
  useEffect(() => { load(); api.get('/games?limit=100').then((d) => setGames(d.items)).catch(() => {}); api.get('/connectors/sample-payload').then(setSample).catch(() => {}); }, []);

  const save = async () => {
    setErr('');
    try {
      const c = await api.post('/connectors', { name: create.name, gameId: create.gameId ? Number(create.gameId) : null });
      setCreate(null); setCreated(c); load();
    } catch (e) { setErr(e.message); }
  };
  const copy = (text, e) => { navigator.clipboard.writeText(text); const b = e.target; const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = t; }, 1200); };

  const curl = (key) => `curl -X POST ${window.location.origin}/api/import/match \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${key}" \\
  -d '${JSON.stringify(sample || {}, null, 0)}'`;

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="mut small">Connectors are API keys for game servers / trackers to push finished-match JSON. One POST creates the match, stats, standings and refreshes every overlay.</span>
        <div className="grow" />
        <button className="btn primary" onClick={() => setCreate({ name: '', gameId: '' })}>New connector</button>
      </div>
      {err && !create && <div className="err">{err}</div>}
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Game</th><th>API key</th><th className="num">Imports</th><th>Last used</th><th style={{ width: 90 }} /></tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b> {!c.isActive && <span className="badge danger">off</span>}</td>
                <td>{c.game?.name || 'Any'}</td>
                <td><code className="k">{c.apiKey.slice(0, 10)}…{c.apiKey.slice(-4)}</code> <button className="btn sm" onClick={(e) => copy(c.apiKey, e)}>Copy</button></td>
                <td className="num">{c.imports}</td>
                <td className="mut small">{c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString() : 'Never'}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn sm" onClick={() => api.patch(`/connectors/${c.id}`, { isActive: !c.isActive }).then(load)}>{c.isActive ? 'Disable' : 'Enable'}</button>
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} className="empty">No connectors yet — create one to get an API key.</td></tr>}
          </tbody>
        </table>
      </div>
      {sample && (
        <div className="card">
          <div className="chead"><h3>Import payload format — POST /api/import/match</h3></div>
          <div className="cbody"><pre style={{ overflow: 'auto', fontSize: 12.5, lineHeight: 1.5 }}>{JSON.stringify(sample, null, 2)}</pre></div>
        </div>
      )}
      {create && (
        <Modal title="New connector" onClose={() => setCreate(null)}
          footer={<><button className="btn" onClick={() => setCreate(null)}>Cancel</button><button className="btn primary" onClick={save}>Create & get key</button></>}>
          {err && <div className="err">{err}</div>}
          <Field label="Name"><input value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} placeholder="BGMI server webhook" /></Field>
          <Field label="Game (optional)">
            <select value={create.gameId} onChange={(e) => setCreate({ ...create, gameId: e.target.value })}>
              <option value="">Any game</option>
              {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
        </Modal>
      )}
      {created && (
        <Modal title="Connector created" wide onClose={() => setCreated(null)}
          footer={<button className="btn primary" onClick={() => setCreated(null)}>Done</button>}>
          <div className="notice">Save this API key now — treat it like a password.</div>
          <Field label="API key"><div className="row"><code className="k" style={{ flex: 1, padding: 8 }}>{created.apiKey}</code><button className="btn sm" onClick={(e) => copy(created.apiKey, e)}>Copy</button></div></Field>
          <Field label="Test with curl"><pre style={{ overflow: 'auto', fontSize: 12, background: 'var(--panel2)', padding: 12, borderRadius: 8 }}>{curl(created.apiKey)}</pre></Field>
        </Modal>
      )}
    </>
  );
}
