// Seed: admin user, games + maps, point rule, 16-team demo tournament with 3 published matches.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { importMatch } from '../src/services/importService.js';

const prisma = new PrismaClient();

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const TEAMS = [
  'Void Sentinels', 'Crimson Wolves', 'Iron Falcons', 'Night Owls',
  'Storm Riders', 'Lunar Eclipse', 'Blaze Kings', 'Shadow Strike',
  'Royal Bengals', 'Desert Vipers', 'Frost Giants', 'Thunder Clan',
  'Neon Ninjas', 'Phantom Ops', 'Skyline Squad', 'Inferno Five',
];

async function main() {
  const email = (process.env.ADMIN_EMAIL || 'admin@uetms.local').toLowerCase();
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      username: process.env.ADMIN_USERNAME || 'admin',
      passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@123', 10),
      role: 'SUPER_ADMIN',
    },
  });
  console.log(`[seed] super admin: ${admin.email}`);

  const gamesData = [
    { name: 'BGMI', slug: 'bgmi', shortName: 'BGMI', maps: ['Erangel', 'Miramar', 'Sanhok', 'Vikendi'] },
    { name: 'PUBG Mobile', slug: 'pubg-mobile', shortName: 'PUBGM', maps: ['Erangel', 'Miramar'] },
    { name: 'Free Fire', slug: 'free-fire', shortName: 'FF', maps: ['Bermuda', 'Purgatory', 'Kalahari'] },
    { name: 'Valorant', slug: 'valorant', shortName: 'VAL', maps: ['Ascent', 'Bind', 'Haven'] },
    { name: 'CS2', slug: 'cs2', shortName: 'CS2', maps: ['Mirage', 'Inferno', 'Nuke'] },
  ];
  const games = {};
  for (const g of gamesData) {
    const game = await prisma.game.upsert({ where: { slug: g.slug }, update: {}, create: { name: g.name, slug: g.slug, shortName: g.shortName } });
    games[g.slug] = game;
    for (const m of g.maps) {
      await prisma.gameMap.upsert({ where: { gameId_name: { gameId: game.id, name: m } }, update: {}, create: { gameId: game.id, name: m } });
    }
  }
  console.log('[seed] games + maps ready');

  let rule = await prisma.pointRule.findFirst({ where: { name: 'BGMI Standard (SUPER)' } });
  if (!rule) {
    rule = await prisma.pointRule.create({
      data: {
        name: 'BGMI Standard (SUPER)', gameId: games.bgmi.id, isDefault: true, killPoint: 1,
        placementPoints: [10, 6, 5, 4, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    });
  }

  const slug = 'uetms-championship-2026';
  let tournament = await prisma.tournament.findUnique({ where: { slug } });
  if (tournament) { console.log('[seed] demo tournament already exists — skipping'); return; }
  tournament = await prisma.tournament.create({
    data: {
      name: 'UETMS Championship 2026', slug, gameId: games.bgmi.id, organizer: 'UETMS',
      country: 'IN', status: 'LIVE', pointRuleId: rule.id, prizePool: '₹10,00,000',
      startDate: new Date(), createdById: admin.id,
    },
  });

  const rand = rng(2026);
  for (const [i, name] of TEAMS.entries()) {
    const team = await prisma.team.create({
      data: {
        name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        shortName: name.split(' ').map((w) => w[0]).join('').slice(0, 4).toUpperCase() + (i < 9 ? '' : ''),
        country: 'IN',
      },
    });
    await prisma.tournamentTeam.create({ data: { tournamentId: tournament.id, teamId: team.id, seed: i + 1 } });
    for (let p = 1; p <= 4; p += 1) {
      const player = await prisma.player.create({
        data: { ign: `${team.shortName}${['Ace', 'Rex', 'Zed', 'Neo'][p - 1]}`, currentTeamId: team.id, role: ['IGL', 'Assaulter', 'Support', 'Sniper'][p - 1], country: 'IN' },
      });
      await prisma.teamPlayer.create({ data: { teamId: team.id, playerId: player.id } });
    }
  }
  console.log('[seed] 16 teams + 64 players created');

  const maps = ['Erangel', 'Miramar', 'Erangel'];
  for (let m = 0; m < 3; m += 1) {
    const order = [...TEAMS].sort(() => rand() - 0.5);
    const payload = {
      tournament: slug,
      round: 'Day 1',
      externalMatchId: `seed-demo-${m + 1}`,
      map: maps[m],
      autoPublish: true,
      teams: order.map((teamName, idx) => {
        const alive = Math.max(0, 4 - Math.floor(idx / 5));
        const short = teamName.split(' ').map((w) => w[0]).join('').slice(0, 4).toUpperCase();
        return {
          team: teamName,
          placement: idx + 1,
          players: ['Ace', 'Rex', 'Zed', 'Neo'].map((sfx) => ({
            ign: `${short}${sfx}`,
            kills: Math.floor(rand() * (idx < 4 ? 6 : 3)),
            damage: Math.round(rand() * (idx < 4 ? 900 : 450)),
            assists: Math.floor(rand() * 3),
            knocks: Math.floor(rand() * 4),
            headshots: Math.floor(rand() * 3),
            survivalTime: Math.round((30 - idx - rand() * 5) * 60),
          })),
        };
      }),
    };
    const result = await importMatch(payload);
    console.log(`[seed] match ${m + 1} imported → id ${result.match.id}`);
  }
  console.log('[seed] done — demo tournament is live with standings & overlays');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
