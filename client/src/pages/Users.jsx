import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal, { Field } from '../components/Modal.jsx';
import { useAuth } from '../auth.jsx';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'TOURNAMENT_MANAGER', 'DATA_ENTRY', 'OBSERVER', 'CASTER', 'READ_ONLY'];

export default function Users() {
  const { user, can } = useAuth();
  const [items, setItems] = useState([]);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api.get('/users').then((d) => setItems(d.items)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setErr('');
    try {
      if (edit.id) {
        const body = { role: edit.role, isActive: edit.isActive };
        if (edit.password) body.password = edit.password;
        await api.patch(`/users/${edit.id}`, body);
      } else {
        await api.post('/users', edit);
      }
      setEdit(null); load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="mut small">Roles control what each account can do — from full control (Super Admin) down to view-only.</span>
        <div className="grow" />
        {can('SUPER_ADMIN') && <button className="btn primary" onClick={() => setEdit({ email: '', username: '', password: '', role: 'DATA_ENTRY' })}>Add user</button>}
      </div>
      {err && !edit && <div className="err">{err}</div>}
      <div className="card">
        <table className="tbl">
          <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th style={{ width: 70 }} /></tr></thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id}>
                <td><b>{u.username}</b>{u.id === user.id && <span className="mut small"> (you)</span>}</td>
                <td>{u.email}</td>
                <td><span className="badge">{u.role.replace('_', ' ')}</span></td>
                <td>{u.isActive ? <span className="badge ok">Active</span> : <span className="badge danger">Disabled</span>}</td>
                <td className="mut small">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {can('SUPER_ADMIN') && <button className="btn sm" onClick={() => setEdit({ id: u.id, username: u.username, role: u.role, isActive: u.isActive, password: '' })}>Edit</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.username}` : 'Add user'} onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save user</button></>}>
          {err && <div className="err">{err}</div>}
          {!edit.id && (<>
            <Field label="Email"><input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Username"><input value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></Field>
          </>)}
          <Field label="Role">
            <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <Field label={edit.id ? 'New password (leave blank to keep current)' : 'Password'}>
            <input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
          </Field>
          {edit.id && (
            <Field label="Status">
              <select value={edit.isActive ? '1' : '0'} onChange={(e) => setEdit({ ...edit, isActive: e.target.value === '1' })}>
                <option value="1">Active</option><option value="0">Disabled</option>
              </select>
            </Field>
          )}
        </Modal>
      )}
    </>
  );
}
