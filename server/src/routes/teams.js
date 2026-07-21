import { crudRouter } from '../lib/crud.js';
import { prisma } from '../lib/prisma.js';
import { uniqueSlug } from '../utils/slug.js';

export default crudRouter('team', {
  fields: ['name', 'shortName', 'logoUrl', 'country', 'organizationId', 'isActive'],
  searchFields: ['name', 'shortName'],
  include: {
    organization: true,
    currentPlayers: { where: { deletedAt: null }, select: { id: true, ign: true, role: true, photoUrl: true } },
    _count: { select: { teamStats: true } },
  },
  orderBy: { name: 'asc' },
  writeRole: 'TOURNAMENT_MANAGER',
  softDelete: true,
  transform: async (data, req, isCreate) => {
    if (isCreate && data.name) data.slug = await uniqueSlug(prisma.team, data.name);
    if (isCreate && !data.shortName && data.name) data.shortName = data.name.slice(0, 4).toUpperCase();
    return data;
  },
});
