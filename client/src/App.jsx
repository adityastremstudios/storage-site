import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Tournaments from './pages/Tournaments.jsx';
import TournamentDetail from './pages/TournamentDetail.jsx';
import Teams from './pages/Teams.jsx';
import Players from './pages/Players.jsx';
import Games from './pages/Games.jsx';
import Users from './pages/Users.jsx';
import Connectors from './pages/Connectors.jsx';
import Feeds from './pages/Feeds.jsx';
// NEW — Statistics Center
import Statistics from './pages/Statistics.jsx';
import { PlayerProfile, TeamProfile, Compare } from './pages/Profiles.jsx';
import { MatchStats, CasterPanel } from './pages/MatchStats.jsx';

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="empty">Loading…</div>;
  if (!user) return <Login />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tournaments" element={<Tournaments />} />
        <Route path="/tournaments/:id" element={<TournamentDetail />} />
        <Route path="/teams" element={<Teams />} />
        <Route path="/players" element={<Players />} />
        <Route path="/games" element={<Games />} />
        <Route path="/users" element={<Users />} />
        <Route path="/connectors" element={<Connectors />} />
        <Route path="/feeds" element={<Feeds />} />

        {/* Statistics Center */}
        <Route path="/stats" element={<Statistics />} />
        <Route path="/stats/players/:id" element={<PlayerProfile />} />
        <Route path="/stats/teams/:id" element={<TeamProfile />} />
        <Route path="/stats/compare" element={<Compare />} />
        <Route path="/stats/matches/:id" element={<MatchStats />} />
        <Route path="/stats/caster/:tournamentId" element={<CasterPanel />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
