import crypto from 'node:crypto';
import { crudRouter } from '../lib/crud.js';

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

export default crudRouter('apiConnector', {
  fields: ['name', 'gameId', 'type', 'config', 'isActive'],
  searchFields: ['name'],
  include: { game: { select: { id: true, name: true } } },
  writeRole: 'ADMIN',
  transform: async (data, req, isCreate) => {
    if (isCreate) data.apiKey = `uet_${crypto.randomBytes(24).toString('hex')}`;
    return data;
  },
  extend: (r) => {
    r.get('/sample-payload', (req, res) => res.json(sample(req.query.tournament || 'demo-tournament-slug')));
  },
});
