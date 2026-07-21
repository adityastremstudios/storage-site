export function toCSV(rows, columns) {
  // columns: [{ key, label }] — rows: array of objects
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.key === 'function' ? c.key(r) : r[c.key])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}
