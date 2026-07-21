import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Modal, { Field } from '../components/Modal.jsx';
import { useAuth } from '../auth.jsx';

const STATUSES = ['DRAFT', 'UPCOMING', 'LIVE', 'COMPLETED', 'ARCHIVED'];
const empty = { name: '', gameId: '', organizer: '', country: 'IN', timezone: 'Asia/Kolkata', status: 'DRAFT', pointRuleId: '', prizePool: '', logoUrl: '', bannerUrl: '', startDate: '', endDate: '' };

export default function Tournaments() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [games, setGames] = useState([]);
  const [rules, setRules] = useState([]);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api.get(`/tournaments?q=${encodeURIComponent(q)}&limit=200`).then((d) => setItems(d.items)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [q]);
  useEffect(() => {
    api.get('/games?limit=100').then((d) => setGames(d.items)).catch(() => {});
    api.get('/pointrules?limit=100').then((d) => setRules(d.items)).catch(() => {});
  }, []);

  const save = async () => {
    setErr('');
    const body = { ...edit, gameId: Number(edit.gameId), pointRuleId: edit.pointRuleId ? Number(edit.pointRuleId) : null };
    try {
      if (edit.id) { await api.patch(`/tournaments/${edit.id}`, body); setEdit(null); load(); }
      else { const t = await api.post('/tournaments', body); setEdit(null); nav(`/tournaments/${t.id}`); }
    } catch (e) { setErr(e.message); }
  };
  const clone = async (t) => { const c = await api.post(`/tournaments/${t.id}/clone`, {}); nav(`/tournaments/${c.id}`); };
  const archive = async (t) => { if (confirm(`Archive ${t.name}?`)) { await api.post(`/tournaments/${t.id}/archive`, {}); load(); } };
  const remove = async (t) => { if (confirm(`Delete ${t.name}? (soft delete — restorable)`)) { await api.del(`/tournaments/${t.id}`); load(); } };

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <input placeholder="Search tournaments…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <div className="grow" />
        {can('TOURNAMENT_MANAGER') && <button className="btn primary" onClick={() => setEdit({ ...empty, gameId: games[0]?.id || '' })}>Create tournament</button>}
      </div>
      {err && !edit && <div className="err">{err}</div>}
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Tournament</th><th>Game</th><th>Status</th><th className="num">Teams</th><th className="num">Matches</th><th style={{ width: 220 }} /></tr></thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.logoUrl && <img className="rowlogo" src={t.logoUrl} alt="" />}
                  <Link to={`/tournaments/${t.id}`}><b>{t.name}</b></Link>
                  <div className="mut small">{t.organizer || ''} · <code className="k">{t.slug}</code></div>
                </td>
                <td>{t.game?.name}</td>
                <td><span className={`badge ${t.status === 'LIVE' ? 'live' : t.status === 'COMPLETED' ? 'ok' : ''}`}>{t.status}</span></td>
                <td className="num">{t._count?.entries ?? 0}</td>
                <td className="num">{t._count?.matches ?? 0}</td>
                <td style={{ textAlign: 'right' }}>
                  <Link className="btn sm" to={`/tournaments/${t.id}`}>Open</Link>{' '}
                  {can('TOURNAMENT_MANAGER') && (<>
                    <button className="btn sm" onClick={() => clone(t)}>Clone</button>{' '}
                    <button className="btn sm" onClick={() => archive(t)}>Archive</button>{' '}
                    <button className="btn sm danger" onClick={() => remove(t)}>Delete</button>
                  </>)}
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} className="empty">No tournaments yet — create your first one.</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit tournament' : 'Create tournament'} wide onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>{edit.id ? 'Save changes' : 'Create tournament'}</button></>}>
          {err && <div className="err">{err}</div>}
          <div className="grid2">
            <Field label="Tournament name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Game">
              <select value={edit.gameId} onChange={(e) => setEdit({ ...edit, gameId: e.target.value })}>
                {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
            <Field label="Organizer"><input value={edit.organizer || ''} onChange={(e) => setEdit({ ...edit, organizer: e.target.value })} /></Field>
            <Field label="Point rule">
              <select value={edit.pointRuleId || ''} onChange={(e) => setEdit({ ...edit, pointRuleId: e.target.value })}>
                <option value="">Default (SUPER-style)</option>
                {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Prize pool"><input value={edit.prizePool || ''} onChange={(e) => setEdit({ ...edit, prizePool: e.target.value })} placeholder="₹10,00,000" /></Field>
            <Field label="Country"><input value={edit.country || ''} onChange={(e) => setEdit({ ...edit, country: e.target.value.toUpperCase() })} maxLength={2} /></Field>
            <Field label="Timezone"><input value={edit.timezone || ''} onChange={(e) => setEdit({ ...edit, timezone: e.target.value })} /></Field>
            <Field label="Start date"><input type="date" value={edit.startDate ? String(edit.startDate).slice(0, 10) : ''} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} /></Field>
            <Field label="End date"><input type="date" value={edit.endDate ? String(edit.endDate).slice(0, 10) : ''} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} /></Field>
            <Field label="Logo URL"><input value={edit.logoUrl || ''} onChange={(e) => setEdit({ ...edit, logoUrl: e.target.value })} /></Field>
            <Field label="Banner URL"><input value={edit.bannerUrl || ''} onChange={(e) => setEdit({ ...edit, bannerUrl: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
