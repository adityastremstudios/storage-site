import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/tournaments', label: 'Tournaments' },
  { to: '/teams', label: 'Teams' },
  { to: '/players', label: 'Players' },
  { sec: 'Setup' },
  { to: '/games', label: 'Games & Rules' },
  { to: '/connectors', label: 'API Connectors', role: 'ADMIN' },
  { to: '/users', label: 'Users', role: 'ADMIN' },
];

const TITLES = {
  '/': 'Dashboard', '/tournaments': 'Tournaments', '/teams': 'Teams', '/players': 'Players',
  '/games': 'Games & Rules', '/connectors': 'API Connectors', '/users': 'Users',
};

export default function Layout({ children }) {
  const { user, logout, can } = useAuth();
  const loc = useLocation();
  const [theme, setTheme] = useState(localStorage.getItem('uetms_theme') || 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('uetms_theme', theme);
  }, [theme]);

  const title = TITLES[loc.pathname] || (loc.pathname.startsWith('/tournaments/') ? 'Tournament' : 'UETMS');

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><div className="mark" /><b>UETMS</b></div>
        {NAV.map((n, i) => n.sec
          ? <div key={i} className="sec">{n.sec}</div>
          : (!n.role || can(n.role)) && (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav ${isActive ? 'on' : ''}`}>
              {n.label}
            </NavLink>
          ))}
        <div className="sec">Broadcast</div>
        <a className="nav" href="/overlay/" target="_blank" rel="noreferrer">Overlay Directory ↗</a>
        <a className="nav" href="/" target="_blank" rel="noreferrer">Public Website ↗</a>
        <div className="foot">{user?.username} · {user?.role?.replace('_', ' ')}</div>
      </aside>
      <div className="main">
        <div className="topbar">
          <div className="title">{title}</div>
          <div className="grow" />
          <button className="btn sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <button className="btn sm" onClick={logout}>Sign out</button>
        </div>
        <div className="page">{children}</div>
      </div>
    </div>
  );
}
