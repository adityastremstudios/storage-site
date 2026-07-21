import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';
import { initSocket } from './lib/socket.js';
import { cacheStatus } from './lib/cache.js';
import { notFound, errorHandler } from './middleware/error.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import { gamesRouter, mapsRouter, pointRulesRouter } from './routes/games.js';
import teamRoutes from './routes/teams.js';
import playerRoutes from './routes/players.js';
import tournamentRoutes from './routes/tournaments.js';
import roundRoutes from './routes/rounds.js';
import matchRoutes from './routes/matches.js';
import importRoutes from './routes/import.js';
import publicRoutes from './routes/public.js';
import searchRoutes from './routes/search.js';
import reportRoutes from './routes/reports.js';
import dashboardRoutes from './routes/dashboard.js';
import mediaRoutes, { uploadsDir } from './routes/media.js';
import auditRoutes from './routes/audit.js';
import connectorRoutes from './routes/connectors.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '8mb' }));

// --- API ---
app.get('/api/health', async (req, res) => {
  let db = 'ok';
  try { await prisma.$queryRaw`SELECT 1`; } catch { db = 'down'; }
  res.json({ ok: db === 'ok', db, cache: cacheStatus().backend, uptime: Math.round(process.uptime()) });
});
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/games', gamesRouter);
app.use('/api/maps', mapsRouter);
app.use('/api/pointrules', pointRulesRouter);
app.use('/api/teams', teamRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/rounds', roundRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/import', importRoutes);
app.use('/api/connectors', connectorRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api', notFound);

// --- Static: uploads, overlays, public website, admin SPA ---
app.use('/uploads', express.static(uploadsDir, { maxAge: '7d' }));
app.use('/overlay', express.static(path.join(dirname, '../overlays')));

const adminCandidates = [path.join(dirname, '../public/admin'), path.join(dirname, '../../client/dist')];
const adminDir = adminCandidates.find((p) => fs.existsSync(path.join(p, 'index.html')));
if (adminDir) {
  app.use('/admin', express.static(adminDir));
  app.get('/admin/*', (req, res) => res.sendFile(path.join(adminDir, 'index.html')));
} else {
  app.get('/admin', (req, res) => res.status(503).send('Admin build not found. Run "npm run build" inside client/ (dev: use the Vite dev server on :5173).'));
}

const siteDir = path.join(dirname, '../publicsite');
app.use(express.static(siteDir));
app.get('/', (req, res) => res.sendFile(path.join(siteDir, 'index.html')));

app.use(errorHandler);

const server = http.createServer(app);
initSocket(server, config.corsOrigin);

server.listen(config.port, () => {
  console.log(`UETMS running on http://localhost:${config.port}`);
  console.log(`  Public site : http://localhost:${config.port}/`);
  console.log(`  Admin panel : http://localhost:${config.port}/admin`);
  console.log(`  Overlays    : http://localhost:${config.port}/overlay/`);
});
