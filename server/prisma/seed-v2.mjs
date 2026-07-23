// Seeds the v2 config tables. Safe to re-run — everything is an upsert and
// nothing existing is modified.
//
//   cd server && node prisma/seed-v2.mjs
//
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// --- BR stat definitions ----------------------------------------------------
// These describe the stats UETMS already stores. Declaring them as data is what
// lets a second game (Valorant/CS2) plug in later by adding rows instead of
// rewriting the stats pages.
const BR_PLAYER_STATS = [
  ['kills', 'Kills', 'sum', 'combat', 0, 10],
  ['damage', 'Damage', 'sum', 'combat', 0, 20],
  ['assists', 'Assists', 'sum', 'combat', 0, 30],
  ['knocks', 'Knocks', 'sum', 'combat', 0, 40],
  ['headshots', 'Headshots', 'sum', 'combat', 0, 50],
  ['revives', 'Revives', 'sum', 'support', 0, 60],
  ['survivalTime', 'Survival time', 'sum', 'survival', 0, 70],
  ['deaths', 'Deaths', 'sum', 'combat', 0, 80],
  ['knockedDown', 'Times knocked', 'sum', 'survival', 0, 90],
  ['longestKill', 'Longest kill', 'max', 'combat', 1, 100],
  ['distance', 'Distance travelled', 'sum', 'movement', 0, 110],
  ['heals', 'Heals used', 'sum', 'support', 0, 120],
  ['boosts', 'Boosts used', 'sum', 'support', 0, 130],
  ['clutches', 'Clutches', 'sum', 'combat', 0, 140],
];

const BR_TEAM_STATS = [
  ['kills', 'Kills', 'sum', 'combat', 0, 10],
  ['damage', 'Damage', 'sum', 'combat', 0, 20],
  ['placement', 'Placement', 'last', 'result', 0, 30],
  ['totalPoints', 'Points', 'sum', 'result', 0, 40],
  ['survivalTime', 'Survival time', 'sum', 'survival', 0, 50],
];

// Derived stats — computed, never imported.
const BR_DERIVED = [
  ['kd', 'K/D', 'avg', 'derived', 2, 200, 'kills / max(deaths, 1)'],
  ['dpk', 'Damage per kill', 'avg', 'derived', 0, 210, 'damage / max(kills, 1)'],
  ['knockConversion', 'Knock → kill %', 'avg', 'derived', 1, 220, 'kills / max(knocks, 1) * 100'],
  ['hsPercent', 'Headshot %', 'avg', 'derived', 1, 230, 'headshots / max(kills, 1) * 100'],
];

// --- Achievements -----------------------------------------------------------
// Thresholds live in the database so you can tune them without a deploy.
// basis "match" checks a single match; "tournament" checks the aggregate.
const ACHIEVEMENTS = [
  ['MVP', 'MVP', 'Top impact score in a match', 'gold', { basis: 'match', stat: 'isMvp', op: '>=', value: 1 }],
  ['TERMINATOR', 'Terminator', '10 or more kills in a single match', 'gold', { basis: 'match', stat: 'kills', op: '>=', value: 10 }],
  ['MONSTER_MATCH', 'Monster Match', '1500 or more damage in a single match', 'gold', { basis: 'match', stat: 'damage', op: '>=', value: 1500 }],
  ['SNIPER', 'Sniper', 'A kill from 300m or further', 'silver', { basis: 'match', stat: 'longestKill', op: '>=', value: 300 }],
  ['CLUTCH_KING', 'Clutch King', 'Two or more clutches in a match', 'gold', { basis: 'match', stat: 'clutches', op: '>=', value: 2 }],
  ['SURVIVOR', 'Survivor', 'Survived 25 minutes in a match', 'silver', { basis: 'match', stat: 'survivalTime', op: '>=', value: 1500 }],
  ['ENTRY_FRAGGER', 'Entry Fragger', 'Five or more knocks in a match', 'silver', { basis: 'match', stat: 'knocks', op: '>=', value: 5 }],
  ['SUPPORT_KING', 'Support King', 'Five or more assists in a match', 'silver', { basis: 'match', stat: 'assists', op: '>=', value: 5 }],
  ['REVIVE_MASTER', 'Revive Master', 'Four or more revives in a match', 'silver', { basis: 'match', stat: 'revives', op: '>=', value: 4 }],
  ['GRENADE_KING', 'Grenade King', 'Three or more headshots in a match', 'bronze', { basis: 'match', stat: 'headshots', op: '>=', value: 3 }],
  ['CENTURION', 'Centurion', '100 career kills', 'gold', { basis: 'career', stat: 'kills', op: '>=', value: 100 }],
  ['CONSISTENT', 'Consistent', 'Averaging 5+ kills across a tournament', 'silver', { basis: 'tournament', stat: 'avgKills', op: '>=', value: 5 }],
];

async function main() {
  const games = await prisma.game.findMany();
  if (!games.length) {
    console.log('No games found — run the original seed first.');
    return;
  }

  let statCount = 0;
  for (const game of games) {
    // Only BR games get the BR stat set. H2H games are seeded when you add
    // Valorant/CS2 support; leaving them empty is correct for now.
    if (game.format && game.format !== 'BR') continue;

    const rows = [
      ...BR_PLAYER_STATS.map(([key, label, aggregation, category, decimals, order]) =>
        ({ key, label, scope: 'player', aggregation, category, decimals, order, isDerived: false, formula: null })),
      ...BR_TEAM_STATS.map(([key, label, aggregation, category, decimals, order]) =>
        ({ key, label, scope: 'team', aggregation, category, decimals, order, isDerived: false, formula: null })),
      ...BR_DERIVED.map(([key, label, aggregation, category, decimals, order, formula]) =>
        ({ key, label, scope: 'player', aggregation, category, decimals, order, isDerived: true, formula })),
    ];

    for (const row of rows) {
      await prisma.statDefinition.upsert({
        where: { gameId_scope_key: { gameId: game.id, scope: row.scope, key: row.key } },
        update: { label: row.label, aggregation: row.aggregation, category: row.category, decimals: row.decimals, order: row.order, isDerived: row.isDerived, formula: row.formula },
        create: { gameId: game.id, ...row },
      });
      statCount += 1;
    }
    console.log(`  stat definitions for ${game.name}`);
  }

  for (const [code, name, description, tier, rule] of ACHIEVEMENTS) {
    await prisma.achievementDef.upsert({
      where: { code },
      update: { name, description, tier, rule },
      create: { code, name, description, tier, rule },
    });
  }
  console.log(`  ${ACHIEVEMENTS.length} achievement definitions`);

  // Give every existing point rule an explicit tiebreaker chain so standings
  // are reproducible instead of relying on an implicit sort.
  const rules = await prisma.pointRule.findMany({ where: { tiebreakers: null } });
  for (const rule of rules) {
    await prisma.pointRule.update({
      where: { id: rule.id },
      data: { tiebreakers: ['points', 'wwcd', 'placementPoints', 'kills', 'lastPlacement'] },
    });
  }
  if (rules.length) console.log(`  tiebreakers set on ${rules.length} point rule(s)`);

  console.log(`\nDone. ${statCount} stat definitions across ${games.length} game(s).`);
  console.log('Next: POST /api/stats/recalc { "tournamentId": <id>, "scope": "all" }');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
