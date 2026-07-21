import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal, { Field } from '../components/Modal.jsx';
import { useAuth } from '../auth.jsx';

const empty = { ign: '', realName: '', country: '', role: '', currentTeamId: '', photoUrl: '' };

export default function Players() {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [teams, setTeams] = useState([]);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api.get(`/players?q=${encodeURIComponent(q)}&limit=400`).then((d) => setItems(d.items)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [q]);
  useEffect(() => { api.get('/teams?limit=400').then((d) => setTeams(d.items)).catch(() => {}); }, []);

  const save = async () => {
    setErr('');
    const body = { ...edit, currentTeamId: edit.currentTeamId ? Number(edit.currentTeamId) : null };
    try {
      if (edit.id) await api.patch(`/players/${edit.id}`, body);
      else await api.post('/players', body);
      setEdit(null); load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <input placeholder="Search by IGN or name…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <div className="grow" />
        {can('TOURNAMENT_MANAGER') && <button className="btn primary" onClick={() => setEdit({ ...empty })}>Add player</button>}
      </div>
      {err && !edit && <div className="err">{err}</div>}
      <div className="card">
        <table className="tbl">
          <thead><tr><th>IGN</th><th>Real name</th><th>Team</th><th>Role</th><th>Country</th><th style={{ width: 80 }} /></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td><b>{p.ign}</b></td>
                <td>{p.realName || '—'}</td>
                <td>{p.currentTeam?.name || <span className="mut">Free agent</span>}</td>
                <td>{p.role || '—'}</td>
                <td>{p.country || '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {can('TOURNAMENT_MANAGER') && (
                    <button className="btn sm" onClick={() => setEdit({ id: p.id, ign: p.ign, realName: p.realName || '', country: p.country || '', role: p.role || '', currentTeamId: p.currentTeamId || '', photoUrl: p.photoUrl || '' })}>Edit</button>
                  )}
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} className="empty">No players yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit player' : 'Add player'} onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save player</button></>}>
          {err && <div className="err">{err}</div>}
          <div className="grid2">
            <Field label="IGN"><input value={edit.ign} onChange={(e) => setEdit({ ...edit, ign: e.target.value })} /></Field>
            <Field label="Real name"><input value={edit.realName} onChange={(e) => setEdit({ ...edit, realName: e.target.value })} /></Field>
            <Field label="Current team">
              <select value={edit.currentTeamId} onChange={(e) => setEdit({ ...edit, currentTeamId: e.target.value })}>
                <option value="">Free agent</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Role"><input value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} placeholder="IGL / Assaulter…" /></Field>
            <Field label="Country code"><input value={edit.country} onChange={(e) => setEdit({ ...edit, country: e.target.value.toUpperCase() })} maxLength={2} /></Field>
            <Field label="Photo URL"><input value={edit.photoUrl} onChange={(e) => setEdit({ ...edit, photoUrl: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
