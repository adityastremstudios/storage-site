// Shared overlay runtime: params, theming, live refresh (socket + poll fallback).
const OV = (() => {
  const P = new URLSearchParams(location.search);
  const slug = P.get('t') || '';
  const accent = P.get('accent') || '#F0B429';
  document.documentElement.style.setProperty('--accent', accent);
  const bg = P.get('bg') || 'transparent';
  if (bg === 'green') document.body.style.background = '#00b140';
  else if (bg === 'dark') document.body.style.background = '#0B0E14';

  async function get(path) {
    const res = await fetch(`/api/public/t/${encodeURIComponent(slug)}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  function live(reload) {
    try {
      const s = io();
      s.on('connect', () => s.emit('join', slug));
      s.on('refresh', (p) => { if (!p || p.slug === slug) reload(); });
    } catch (e) { /* socket lib missing — polling still works */ }
    setInterval(reload, 25000);
  }
  function need(el) {
    if (!slug) { el.innerHTML = '<div class="waiting">Add ?t=tournament-slug to this URL</div>'; return false; }
    return true;
  }
  return { P, slug, get, live, need };
})();
