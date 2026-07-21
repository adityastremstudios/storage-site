import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal, { Field } from '../components/Modal.jsx';
import { useAuth } from '../auth.jsx';

const empty = { name: '', shortName: '', country: '', logoUrl: '' };

export default function Teams() {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api.get(`/teams?q=${encodeURIComponent(q)}&limit=300`).then((d) => setItems(d.items)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [q]);

  const save = async () => {
    setErr('');
    try {
      if (edit.id) await api.patch(`/teams/${edit.id}`, edit);
      else await api.post('/teams', edit);
      setEdit(null); load();
    } catch (e) { setErr(e.message); }
  };
  const remove = async (t) => {
    if (!confirm(`Remove ${t.name}? It can be restored from the database (soft delete).`)) return;
    await api.del(`/teams/${t.id}`); load();
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <input placeholder="Search teams…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <div className="grow" />
        {can('TOURNAMENT_MANAGER') && <button className="btn primary" onClick={() => setEdit({ ...empty })}>Add team</button>}
      </div>
      {err && !edit && <div className="err">{err}</div>}
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Team</th><th>Tag</th><th>Country</th><th>Roster</th><th style={{ width: 130 }} /></tr></thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td>{t.logoUrl && <img className="rowlogo" src={t.logoUrl} alt="" />}<b>{t.name}</b></td>
                <td>{t.shortName}</td>
                <td>{t.country || '—'}</td>
                <td className="mut small">{(t.currentPlayers || []).map((p) => p.ign).join(', ') || '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {can('TOURNAMENT_MANAGER') && (<>
                    <button className="btn sm" onClick={() => setEdit({ id: t.id, name: t.name, shortName: t.shortName || '', country: t.country || '', logoUrl: t.logoUrl || '' })}>Edit</button>{' '}
                    <button className="btn sm danger" onClick={() => remove(t)}>Delete</button>
                  </>)}
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={5} className="empty">No teams yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit team' : 'Add team'} onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save team</button></>}>
          {err && <div className="err">{err}</div>}
          <div className="grid2">
            <Field label="Team name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Short tag"><input value={edit.shortName} onChange={(e) => setEdit({ ...edit, shortName: e.target.value.toUpperCase() })} maxLength={5} /></Field>
            <Field label="Country code"><input value={edit.country} onChange={(e) => setEdit({ ...edit, country: e.target.value.toUpperCase() })} maxLength={2} placeholder="IN" /></Field>
            <Field label="Logo URL"><input value={edit.logoUrl} onChange={(e) => setEdit({ ...edit, logoUrl: e.target.value })} placeholder="https://…" /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
