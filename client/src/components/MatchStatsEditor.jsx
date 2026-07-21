import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';

// Manual stats entry (Data Entry workflow) — same pipeline the API import uses.
export default function MatchStatsEditor({ match, entries, onClose, onSaved }) {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      let existing = null;
      try { existing = await api.get(`/matches/${match.id}/full`); } catch { /* new match */ }
      const byTeam = new Map((existing?.teamStats || []).map((s) => [s.teamId, s]));
      const playersByTeam = new Map();
      for (const ps of existing?.playerStats || []) {
        if (!playersByTeam.has(ps.teamId)) playersByTeam.set(ps.teamId, []);
        playersByTeam.get(ps.teamId).push({ ign: ps.player.ign, kills: ps.kills, damage: Math.round(ps.damage) });
      }
      setRows(entries.map((e, i) => {
        const s = byTeam.get(e.team.id);
        const roster = (e.team.currentPlayers || []).map((p) => ({ ign: p.ign, kills: 0, damage: 0 }));
        return {
          teamId: e.team.id,
          name: e.team.name,
          placement: s?.placement ?? i + 1,
          kills: s?.kills ?? '',
          open: false,
          players: playersByTeam.get(e.team.id) || roster,
        };
      }));
    })();
  }, [match.id]);

  const set = (i, patch) => setRows(rows.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  const setPlayer = (i, pi, patch) => setRows(rows.map((r, x) => (x === i ? { ...r, players: r.players.map((p, y) => (y === pi ? { ...p, ...patch } : p)) } : r)));

  const save = async (publish) => {
    setErr('');
    const placements = rows.map((r) => Number(r.placement));
    if (new Set(placements).size !== placements.length) { setErr('Every team needs a unique placement.'); return; }
    setBusy(true);
    try {
      await api.post(`/matches/${match.id}/stats`, {
        autoPublish: publish,
        teams: rows.map((r) => ({
          team: r.teamId,
          placement: Number(r.placement),
          kills: r.kills === '' ? undefined : Number(r.kills),
          players: r.players.filter((p) => p.ign).map((p) => ({ ign: p.ign, kills: Number(p.kills) || 0, damage: Number(p.damage) || 0 })),
        })),
      });
      onSaved();
    } catch (e) { setErr(e.message + (e.details ? ' — ' + e.details.map((d) => d.message).join(', ') : '')); }
    finally { setBusy(false); }
  };

  const sorted = [...rows].map((r, i) => ({ ...r, _i: rows.indexOf(r) }));

  return (
    <Modal title={`Match ${match.matchNumber} — enter results`} wide onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy} onClick={() => save(false)}>Save as completed</button>
        <button className="btn primary" disabled={busy} onClick={() => save(true)}>Save & publish live</button>
      </>}>
      {err && <div className="err">{err}</div>}
      <p className="mut small" style={{ marginBottom: 12 }}>
        Team kills auto-sum from player kills if left blank. "Save & publish" recalculates standings and refreshes every overlay and the website instantly.
      </p>
      <table className="tbl">
        <thead><tr><th style={{ width: 90 }}>Place</th><th>Team</th><th style={{ width: 110 }}>Team kills</th><th style={{ width: 110 }} /></tr></thead>
        <tbody>
          {sorted.map((r) => (
            <React.Fragment key={r.teamId}>
              <tr>
                <td><input type="number" min="1" value={r.placement} onChange={(e) => set(r._i, { placement: e.target.value })} style={{ width: 70 }} /></td>
                <td><b>{r.name}</b></td>
                <td><input type="number" min="0" placeholder="auto" value={r.kills} onChange={(e) => set(r._i, { kills: e.target.value })} style={{ width: 90 }} /></td>
                <td><button className="btn sm" onClick={() => set(r._i, { open: !r.open })}>{r.open ? 'Hide players' : 'Players'}</button></td>
              </tr>
              {r.open && (
                <tr><td colSpan={4} style={{ background: 'var(--bg)' }}>
                  <div className="row" style={{ padding: '8px 4px', alignItems: 'flex-end' }}>
                    {r.players.map((p, pi) => (
                      <div key={pi} style={{ minWidth: 150 }}>
                        <div className="mut small" style={{ marginBottom: 3 }}><b>{p.ign}</b></div>
                        <div className="row" style={{ gap: 6 }}>
                          <input type="number" min="0" title="Kills" value={p.kills} onChange={(e) => setPlayer(r._i, pi, { kills: e.target.value })} style={{ width: 62 }} />
                          <input type="number" min="0" title="Damage" value={p.damage} onChange={(e) => setPlayer(r._i, pi, { damage: e.target.value })} style={{ width: 78 }} />
                        </div>
                        <div className="mut" style={{ fontSize: 10.5, marginTop: 2 }}>kills / dmg</div>
                      </div>
                    ))}
                    {!r.players.length && <span className="mut small">No roster on this team — add players first, or just enter team kills.</span>}
                  </div>
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
