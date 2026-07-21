import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, getAuth, setAuth } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

const LEVEL = { READ_ONLY: 0, CASTER: 1, OBSERVER: 1, DATA_ENTRY: 2, TOURNAMENT_MANAGER: 3, ADMIN: 4, SUPER_ADMIN: 5 };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getAuth()?.user || null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      if (getAuth()?.accessToken) {
        try { setUser(await api.get('/auth/me')); }
        catch { setAuth(null); setUser(null); }
      }
      setReady(true);
    })();
  }, []);

  const login = async (emailOrUsername, password) => {
    const data = await api.post('/auth/login', { emailOrUsername, password });
    setAuth(data); setUser(data.user);
  };
  const logout = async () => {
    try { await api.post('/auth/logout', {}); } catch { /* ignore */ }
    setAuth(null); setUser(null);
  };
  const can = (role) => user && LEVEL[user.role] >= LEVEL[role];

  return <Ctx.Provider value={{ user, ready, login, logout, can }}>{children}</Ctx.Provider>;
}
