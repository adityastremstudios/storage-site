import React from 'react';
import { Link } from 'react-router-dom';

// A stat the source never sent must read as "—", never as 0. A zero on the
// broadcast overlay looks like real data and is how you get corrected on air.
export function Stat({ value, decimals = 0, suffix = '' }) {
  if (value === null || value === undefined) return <span className="mut">—</span>;
  const n = Number(value);
  if (!Number.isFinite(n)) return <span className="mut">—</span>;
  return <>{decimals ? n.toFixed(decimals) : Math.round(n).toLocaleString('en-IN')}{suffix}</>;
}

export function Duration({ seconds }) {
  if (seconds === null || seconds === undefined) return <span className="mut">—</span>;
  const s = Math.max(0, Math.round(Number(seconds)));
  const m = Math.floor(s / 60);
  return <>{m}:{String(s % 60).padStart(2, '0')}</>;
}

export function StatCard({ label, value, decimals = 0, suffix = '', hint }) {
  return (
    <div className="stat">
      <div className="small mut">{label}</div>
      <div className="disp"><Stat value={value} decimals={decimals} suffix={suffix} /></div>
      {hint ? <div className="small mut">{hint}</div> : null}
    </div>
  );
}

export function TeamCell({ team }) {
  if (!team) return <span className="mut">—</span>;
  return (
    <span className="rowlogo">
      {team.logoUrl ? <img src={team.logoUrl} alt="" width="20" height="20" /> : null}
      <Link to={`/stats/teams/${team.id}`}>{team.shortName || team.name}</Link>
    </span>
  );
}

export function PlayerCell({ player }) {
  if (!player) return <span className="mut">—</span>;
  return (
    <span className="rowlogo">
      {player.photoUrl ? <img src={player.photoUrl} alt="" width="20" height="20" /> : null}
      <Link to={`/stats/players/${player.id}`}>{player.ign}</Link>
    </span>
  );
}

export function SourceBadge({ source }) {
  if (source !== 'MANUAL') return null;
  return <span className="badge" title="Manually edited — the feed will not overwrite this">edited</span>;
}

export function Loading({ children = 'Loading…' }) {
  return <div className="empty">{children}</div>;
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="err">
      {error}
      {onRetry ? <> <button className="btn" onClick={onRetry}>Try again</button></> : null}
    </div>
  );
}

/** Filter bar shared by every statistics page. */
export function Filters({ value, onChange, tournaments = [], fields = [] }) {
  const set = (k, v) => onChange({ ...value, [k]: v || '' });
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      {fields.includes('tournament') && (
        <select value={value.tournament || ''} onChange={(e) => set('tournament', e.target.value)}>
          <option value="">All tournaments (career)</option>
          {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {fields.includes('sort') && (
        <select value={value.sort || ''} onChange={(e) => set('sort', e.target.value)}>
          <option value="">Sort: kills</option>
          <option value="damage">Damage</option>
          <option value="avgKills">Avg kills</option>
          <option value="avgDamage">Avg damage</option>
          <option value="assists">Assists</option>
          <option value="headshots">Headshots</option>
          <option value="mvp">MVP count</option>
          <option value="matches">Matches</option>
        </select>
      )}
      {fields.includes('minMatches') && (
        <input type="number" min="0" placeholder="Min matches"
          value={value.minMatches || ''} onChange={(e) => set('minMatches', e.target.value)} style={{ width: 110 }} />
      )}
      {fields.includes('minKills') && (
        <input type="number" min="0" placeholder="Min kills"
          value={value.minKills || ''} onChange={(e) => set('minKills', e.target.value)} style={{ width: 100 }} />
      )}
      {fields.includes('country') && (
        <input placeholder="Country" value={value.country || ''}
          onChange={(e) => set('country', e.target.value)} style={{ width: 110 }} />
      )}
    </div>
  );
}

/** Build a query string, dropping empty values. */
export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === '' || v === null || v === undefined) continue;
    p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Export helpers — CSV and JSON are generated in the browser, no server load. */
export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','));
  return [head, ...body].join('\n');
}

export function ExportButtons({ rows, columns, name }) {
  if (!rows?.length) return null;
  return (
    <span className="row" style={{ gap: 6 }}>
      <button className="btn" onClick={() => download(`${name}.csv`, toCsv(rows, columns), 'text/csv')}>CSV</button>
      <button className="btn" onClick={() => download(`${name}.json`, JSON.stringify(rows, null, 2), 'application/json')}>JSON</button>
      <button className="btn" onClick={() => window.print()} title="Use your browser's Save as PDF">PDF</button>
    </span>
  );
}
