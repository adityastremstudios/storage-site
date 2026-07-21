import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal, { Field } from '../components/Modal.jsx';
import { useAuth } from '../auth.jsx';

export default function Games() {
  const { can } = useAuth();
  const [games, setGames] = useState([]);
  const [maps, setMaps] = useState([]);
  const [rules, setRules] = useState([]);
  const [editGame, setEditGame] = useState(null);
  const [editMap, setEditMap] = useState(null);
  const [editRule, setEditRule] = useState(null);
  const [err, setErr] = useState('');

  const load = () => Promise.all([
    api.get('/games?limit=100').then((d) => setGames(d.items)),
    api.get('/maps?limit=300').then((d) => setMaps(d.items)),
    api.get('/pointrules?limit=100').then((d) => setRules(d.items)),
  ]).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const saveGame = async () => {
    try {
      if (editGame.id) await api.patch(`/games/${editGame.id}`, editGame);
      else await api.post('/games', editGame);
      setEditGame(null); setErr(''); load();
    } catch (e) { setErr(e.message); }
  };
  const saveMap = async () => {
    try {
      const body = { ...editMap, gameId: Number(editMap.gameId) };
      if (editMap.id) await api.patch(`/maps/${editMap.id}`, body); else await api.post('/maps', body);
      setEditMap(null); setErr(''); load();
    } catch (e) { setErr(e.message); }
  };
  const saveRule = async () => {
    try {
      const pp = editRule.placementText.split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x));
      const body = { name: editRule.name, gameId: editRule.gameId ? Number(editRule.gameId) : null, killPoint: Number(editRule.killPoint) || 1, placementPoints: pp };
      if (editRule.id) await api.patch(`/pointrules/${editRule.id}`, body); else await api.post('/pointrules', body);
      setEditRule(null); setErr(''); load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      {err && <div className="err">{err}</div>}
      <div className="card">
        <div className="chead"><h3>Games</h3><div className="grow" />
          {can('ADMIN') && <button className="btn sm primary" onClick={() => setEditGame({ name: '', shortName: '', logoUrl: '' })}>Add game</button>}
        </div>
        <table className="tbl">
          <thead><tr><th>Game</th><th>Short</th><th className="num">Tournaments</th><th className="num">Maps</th><th style={{ width: 70 }} /></tr></thead>
          <tbody>
            {games.map((g) => (
              <tr key={g.id}>
                <td>{g.logoUrl && <img className="rowlogo" src={g.logoUrl} alt="" />}<b>{g.name}</b></td>
                <td>{g.shortName}</td>
                <td className="num">{g._count?.tournaments ?? 0}</td>
                <td className="num">{g._count?.maps ?? 0}</td>
                <td style={{ textAlign: 'right' }}>{can('ADMIN') && <button className="btn sm" onClick={() => setEditGame({ id: g.id, name: g.name, shortName: g.shortName || '', logoUrl: g.logoUrl || '' })}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="chead"><h3>Maps</h3><div className="grow" />
          {can('ADMIN') && <button className="btn sm primary" onClick={() => setEditMap({ name: '', gameId: games[0]?.id || '', imageUrl: '' })}>Add map</button>}
        </div>
        <div className="cbody row">
          {maps.map((m) => <span key={m.id} className="badge">{m.game?.name}: <b style={{ color: 'var(--ink)' }}>{m.name}</b></span>)}
          {!maps.length && <span className="mut">No maps yet.</span>}
        </div>
      </div>

      <div className="card">
        <div className="chead"><h3>Point rules</h3><div className="grow" />
          {can('ADMIN') && <button className="btn sm primary" onClick={() => setEditRule({ name: '', gameId: '', killPoint: 1, placementText: '10,6,5,4,3,2,1,1,0,0,0,0,0,0,0,0' })}>Add rule</button>}
        </div>
        <table className="tbl">
          <thead><tr><th>Rule</th><th>Game</th><th>Placement points (1st → last)</th><th className="num">Per kill</th><th style={{ width: 70 }} /></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b> {r.isDefault && <span className="badge ok">default</span>}</td>
                <td>{r.game?.name || 'Any'}</td>
                <td className="mut small">{Array.isArray(r.placementPoints) ? r.placementPoints.join(', ') : ''}</td>
                <td className="num">{r.killPoint}</td>
                <td style={{ textAlign: 'right' }}>{can('ADMIN') && <button className="btn sm" onClick={() => setEditRule({ id: r.id, name: r.name, gameId: r.gameId || '', killPoint: r.killPoint, placementText: (r.placementPoints || []).join(',') })}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editGame && (
        <Modal title={editGame.id ? 'Edit game' : 'Add game'} onClose={() => setEditGame(null)}
          footer={<><button className="btn" onClick={() => setEditGame(null)}>Cancel</button><button className="btn primary" onClick={saveGame}>Save game</button></>}>
          <Field label="Name"><input value={editGame.name} onChange={(e) => setEditGame({ ...editGame, name: e.target.value })} /></Field>
          <Field label="Short name"><input value={editGame.shortName} onChange={(e) => setEditGame({ ...editGame, shortName: e.target.value })} /></Field>
          <Field label="Logo URL"><input value={editGame.logoUrl} onChange={(e) => setEditGame({ ...editGame, logoUrl: e.target.value })} /></Field>
        </Modal>
      )}
      {editMap && (
        <Modal title="Add map" onClose={() => setEditMap(null)}
          footer={<><button className="btn" onClick={() => setEditMap(null)}>Cancel</button><button className="btn primary" onClick={saveMap}>Save map</button></>}>
          <Field label="Game">
            <select value={editMap.gameId} onChange={(e) => setEditMap({ ...editMap, gameId: e.target.value })}>
              {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <Field label="Map name"><input value={editMap.name} onChange={(e) => setEditMap({ ...editMap, name: e.target.value })} /></Field>
        </Modal>
      )}
      {editRule && (
        <Modal title={editRule.id ? 'Edit point rule' : 'Add point rule'} onClose={() => setEditRule(null)}
          footer={<><button className="btn" onClick={() => setEditRule(null)}>Cancel</button><button className="btn primary" onClick={saveRule}>Save rule</button></>}>
          <Field label="Rule name"><input value={editRule.name} onChange={(e) => setEditRule({ ...editRule, name: e.target.value })} /></Field>
          <Field label="Game (optional)">
            <select value={editRule.gameId} onChange={(e) => setEditRule({ ...editRule, gameId: e.target.value })}>
              <option value="">Any game</option>
              {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <Field label="Placement points — comma separated, 1st place first">
            <input value={editRule.placementText} onChange={(e) => setEditRule({ ...editRule, placementText: e.target.value })} />
          </Field>
          <Field label="Points per kill"><input type="number" step="0.5" value={editRule.killPoint} onChange={(e) => setEditRule({ ...editRule, killPoint: e.target.value })} /></Field>
        </Modal>
      )}
    </>
  );
}
