import { crudRouter } from '../lib/crud.js';
import { prisma } from '../lib/prisma.js';
import { generateApiKey } from '../middleware/auth.js';
import { logAudit } from '../middleware/audit.js';

const sample = (tournament = 'demo-tournament-slug') => ({
  tournament,
  round: 'Round 1',
  externalMatchId: 'game-api-match-001',
  map: 'Erangel',
  autoPublish: true,
  teams: [
    { team: 'Team Alpha', placement: 1, players: [{ ign: 'AlphaOne', kills: 6, damage: 812 }, { ign: 'AlphaTwo', kills: 3, damage: 540 }] },
    { team: 'Team Bravo', placement: 2, players: [{ ign: 'BravoOne', kills: 4, damage: 610 }] },
  ],
});

// The generic CRUD router returned every column, including apiKey. Selecting
// explicitly means the secret can never leak through list/detail responses.
const select = {
  id: true, name: true, type: true, gameId: true, config: true, isActive: true,
  imports: true, lastUsedAt: true, createdAt: true, apiKeyPrefix: true,
  tournamentIds: true,
  game: { select: { id: true, name: true } },
};

export default crudRouter('apiConnector', {
  fields: ['name', 'gameId', 'type', 'config', 'isActive', 'tournamentIds'],
  searchFields: ['name'],
  select,
  writeRole: 'ADMIN',
  readRole: 'ADMIN',
  extend: (r, { canWrite }) => {
    r.get('/sample-payload', (req, res) => res.json(sample(req.query.tournament || 'demo-tournament-slug')));

    // Create returns the secret exactly once — it is not recoverable later.
    r.post('/', canWrite, async (req, res, next) => {
      try {
        const { secret, hash, prefix } = generateApiKey();
        const created = await prisma.apiConnector.create({
          data: {
            name: String(req.body.name || 'Connector'),
            gameId: req.body.gameId ? Number(req.body.gameId) : null,
            type: req.body.type || 'push',
            config: req.body.config ?? null,
            isActive: req.body.isActive ?? true,
            tournamentIds: Array.isArray(req.body.tournamentIds) ? req.body.tournamentIds.map(Number) : [],
            apiKey: hash,          // legacy column now holds the hash, never the secret
            apiKeyHash: hash,
            apiKeyPrefix: prefix,
          },
          select,
        });
        await logAudit(req, 'apiConnector', created.id, 'create', null, created);
        res.status(201).json({ ...created, apiKey: secret, warning: 'Copy this key now — it cannot be shown again.' });
      } catch (e) { next(e); }
    });

    // Rotate replaces the key without touching imports/history.
    r.post('/:id(\\d+)/rotate', canWrite, async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const { secret, hash, prefix } = generateApiKey();
        const updated = await prisma.apiConnector.update({
          where: { id },
          data: { apiKey: hash, apiKeyHash: hash, apiKeyPrefix: prefix },
          select,
        });
        await logAudit(req, 'apiConnector', id, 'rotate-key', null, { apiKeyPrefix: prefix });
        res.json({ ...updated, apiKey: secret, warning: 'Copy this key now — it cannot be shown again.' });
      } catch (e) { next(e); }
    });
  },
});
