import { crudRouter } from '../lib/crud.js';
import { prisma } from '../lib/prisma.js';
import { uniqueSlug } from '../utils/slug.js';

export const gamesRouter = crudRouter('game', {
  fields: ['name', 'slug', 'shortName', 'logoUrl', 'statTemplate', 'overlayConfig', 'isActive'],
  searchFields: ['name', 'shortName'],
  include: { _count: { select: { tournaments: true, maps: true } } },
  orderBy: { name: 'asc' },
  writeRole: 'ADMIN',
  transform: async (data, req, isCreate) => {
    if (isCreate && !data.slug && data.name) data.slug = await uniqueSlug(prisma.game, data.name);
    return data;
  },
});

export const mapsRouter = crudRouter('gameMap', {
  fields: ['gameId', 'name', 'imageUrl'],
  searchFields: ['name'],
  include: { game: { select: { id: true, name: true } } },
  orderBy: { name: 'asc' },
  writeRole: 'ADMIN',
});

export const pointRulesRouter = crudRouter('pointRule', {
  fields: ['gameId', 'name', 'placementPoints', 'killPoint', 'isDefault'],
  searchFields: ['name'],
  include: { game: { select: { id: true, name: true } } },
  orderBy: { id: 'asc' },
  writeRole: 'ADMIN',
});
