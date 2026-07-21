const KEY = 'uetms_auth';
let auth = JSON.parse(localStorage.getItem(KEY) || 'null');

export function getAuth() { return auth; }
export function setAuth(next) {
  auth = next;
  if (next) localStorage.setItem(KEY, JSON.stringify(next));
  else localStorage.removeItem(KEY);
}

async function refresh() {
  if (!auth?.refreshToken) return false;
  const res = await fetch('/api/auth/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: auth.refreshToken }),
  });
  if (!res.ok) { setAuth(null); return false; }
  setAuth(await res.json());
  return true;
}

async function req(path, { method = 'GET', body, retry = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth?.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 401 && retry && auth?.refreshToken) {
    if (await refresh()) return req(path, { method, body, retry: false });
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status; err.details = data?.details;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => req(p),
  post: (p, body) => req(p, { method: 'POST', body }),
  patch: (p, body) => req(p, { method: 'PATCH', body }),
  del: (p) => req(p, { method: 'DELETE' }),
};
