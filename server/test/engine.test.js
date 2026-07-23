// Logic tests for the v2 engine. No database required — these cover the pure
// functions where the data-integrity bugs actually lived.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computePoints, mvpScore, rankRows, resolveRule,
  DEFAULT_PLACEMENT_POINTS, DEFAULT_TIEBREAKERS,
} from '../src/services/statsEngine.js';
import { mapFeed, toIsoTimestamp } from '../src/services/feedAdapters.js';

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

test('placement + kill points use the tournament rule', () => {
  const rule = { placementPoints: DEFAULT_PLACEMENT_POINTS, killPoint: 1 };
  assert.deepEqual(computePoints(1, 8, rule), { placementPoints: 10, killPoints: 8, totalPoints: 18 });
  assert.deepEqual(computePoints(16, 0, rule), { placementPoints: 0, killPoints: 0, totalPoints: 0 });
});

test('placement beyond the table scores zero rather than NaN', () => {
  const rule = { placementPoints: [10, 6], killPoint: 1 };
  assert.equal(computePoints(9, 2, rule).placementPoints, 0);
  assert.equal(computePoints(9, 2, rule).totalPoints, 2);
});

test('a tournament pointsOverride beats the linked point rule', () => {
  const rule = resolveRule({
    pointRule: { placementPoints: [10, 6, 5], killPoint: 1, tiebreakers: null },
    pointsOverride: { placementPoints: [15, 12, 10], killPoint: 2 },
  });
  assert.equal(rule.killPoint, 2);
  assert.deepEqual(rule.placementPoints, [15, 12, 10]);
  assert.equal(computePoints(1, 5, rule).totalPoints, 25);
});

test('resolveRule falls back to defaults when nothing is configured', () => {
  const rule = resolveRule(null);
  assert.deepEqual(rule.placementPoints, DEFAULT_PLACEMENT_POINTS);
  assert.equal(rule.killPoint, 1);
  assert.deepEqual(rule.tiebreakers, DEFAULT_TIEBREAKERS);
});

// ---------------------------------------------------------------------------
// Tie-breakers
// ---------------------------------------------------------------------------

const row = (o) => ({
  teamName: 'T', totalPoints: 0, wwcd: 0, placementPoints: 0, totalKills: 0,
  lastPlacement: 99, avgPlacement: 9, totalDamage: 0, ...o,
});

test('higher points always ranks first', () => {
  const ranked = rankRows([row({ teamName: 'A', totalPoints: 40 }), row({ teamName: 'B', totalPoints: 55 })]);
  assert.equal(ranked[0].teamName, 'B');
  assert.equal(ranked[0].rank, 1);
});

test('level on points is split by WWCD and the reason is recorded', () => {
  const ranked = rankRows([
    row({ teamName: 'A', totalPoints: 50, wwcd: 1 }),
    row({ teamName: 'B', totalPoints: 50, wwcd: 3 }),
  ]);
  assert.equal(ranked[0].teamName, 'B');
  assert.match(ranked[1].tiebreakReason, /WWCD/);
});

test('tie-break chain falls through to kills when points and WWCD match', () => {
  const ranked = rankRows([
    row({ teamName: 'A', totalPoints: 50, wwcd: 1, placementPoints: 30, totalKills: 20 }),
    row({ teamName: 'B', totalPoints: 50, wwcd: 1, placementPoints: 30, totalKills: 25 }),
  ]);
  assert.equal(ranked[0].teamName, 'B');
  assert.match(ranked[1].tiebreakReason, /kills/);
});

test('a custom tie-break order changes the result', () => {
  const rows = [
    row({ teamName: 'A', totalPoints: 50, wwcd: 3, totalKills: 10 }),
    row({ teamName: 'B', totalPoints: 50, wwcd: 1, totalKills: 40 }),
  ];
  assert.equal(rankRows([...rows], ['points', 'wwcd'])[0].teamName, 'A');
  assert.equal(rankRows([...rows], ['points', 'kills'])[0].teamName, 'B');
});

test('a fully identical tie is broken by name, never left unranked', () => {
  const ranked = rankRows([row({ teamName: 'Zeta' }), row({ teamName: 'Alpha' })]);
  assert.equal(ranked[0].teamName, 'Alpha');
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
});

test('the leader never carries a tiebreak reason', () => {
  const ranked = rankRows([row({ teamName: 'A', totalPoints: 50 }), row({ teamName: 'B', totalPoints: 50 })]);
  assert.equal(ranked[0].tiebreakReason, null);
});

// ---------------------------------------------------------------------------
// MVP score
// ---------------------------------------------------------------------------

test('MVP score weights kills above raw damage', () => {
  const fragger = mvpScore({ kills: 10, damage: 800 });
  const damageBot = mvpScore({ kills: 2, damage: 1600 });
  assert.ok(fragger > damageBot);
});

test('null stats contribute nothing instead of breaking the score', () => {
  const score = mvpScore({ kills: 5, damage: null, assists: null, knocks: null, revives: null, headshots: null });
  assert.equal(score, 60);
  assert.ok(Number.isFinite(score));
});

test('support play still scores when there are no kills', () => {
  assert.ok(mvpScore({ kills: 0, assists: 4, revives: 3 }) > 0);
});

// ---------------------------------------------------------------------------
// Feed adapter — the silent data-loss fixes
// ---------------------------------------------------------------------------

const scoreboard = (over = {}) => ({
  success: true,
  matchId: 'M-42',
  timestamp: 1735689600,
  data: [
    {
      name: 'Team Alpha', tag: 'ALP', totalKills: 9, rank: 1, isDead: false,
      survivalSeconds: 1820,
      players: [
        { name: 'AlphaOne', knockCount: 5, elimCount: 0 },
        { name: 'AlphaTwo', knockCount: 4, elimCount: 0 },
      ],
    },
    {
      name: 'Team Bravo', tag: 'BRV', totalKills: 4, rank: 2, isDead: true,
      survivalSeconds: 1200, eliminationTime: 1200,
      players: [{ name: 'BravoOne', knockCount: 4, elimCount: 0 }],
    },
  ],
  ...over,
});

test('team survivalTime now survives the adapter (was silently dropped)', () => {
  const mapped = mapFeed(scoreboard());
  assert.equal(mapped.teams[0].survivalTime, 1820);
  assert.equal(mapped.teams[1].survivalTime, 1200);
});

test('when knockCount is the frag column, knocks stays undefined not zero', () => {
  const mapped = mapFeed(scoreboard());
  assert.equal(mapped.killField, 'knock');
  const p = mapped.teams[0].players[0];
  assert.equal(p.kills, 5);
  assert.equal(p.knocks, undefined, 'a fake 0 here would make "Top Knockdowns" permanently empty-but-populated');
});

test('when elimCount is the frag column, knocks is preserved as real data', () => {
  const raw = scoreboard({
    data: [
      { name: 'A', totalKills: 6, rank: 1, players: [{ name: 'a1', elimCount: 6, knockCount: 9 }] },
      { name: 'B', totalKills: 2, rank: 2, players: [{ name: 'b1', elimCount: 2, knockCount: 3 }] },
    ],
  });
  const mapped = mapFeed(raw);
  assert.equal(mapped.killField, 'elim');
  assert.equal(mapped.teams[0].players[0].kills, 6);
  assert.equal(mapped.teams[0].players[0].knocks, 9);
});

test('damage is left undefined when the feed does not carry it', () => {
  const mapped = mapFeed(scoreboard());
  assert.equal(mapped.teams[0].players[0].damage, undefined,
    'storing 0 would make "Highest Damage" read 0 on the broadcast overlay');
});

test('epoch seconds no longer resolve to 1970', () => {
  const mapped = mapFeed(scoreboard({ timestamp: 1735689600 }));
  assert.equal(new Date(mapped.playedAt).getUTCFullYear(), 2025);
});

test('epoch milliseconds still work', () => {
  assert.equal(new Date(toIsoTimestamp(1735689600000)).getUTCFullYear(), 2025);
});

test('a bad timestamp yields null rather than an Invalid Date', () => {
  assert.equal(toIsoTimestamp('not-a-date'), null);
  assert.equal(toIsoTimestamp(0), null);
});

test('placement is derived when the feed sends no usable rank', () => {
  const mapped = mapFeed(scoreboard({
    data: [
      { name: 'Dead Early', totalKills: 1, rank: '-', isDead: true, survivalSeconds: 300, players: [] },
      { name: 'Still Alive', totalKills: 5, rank: '-', isDead: false, survivalSeconds: 1500, players: [] },
      { name: 'Dead Late', totalKills: 3, rank: '-', isDead: true, survivalSeconds: 1100, players: [] },
    ],
  }));
  assert.deepEqual(mapped.teams.map((t) => t.team), ['Still Alive', 'Dead Late', 'Dead Early']);
  assert.deepEqual(mapped.teams.map((t) => t.placement), [1, 2, 3]);
});

test('a live match is flagged unfinished so it is not imported early', () => {
  const mapped = mapFeed(scoreboard({
    data: [
      { name: 'A', totalKills: 3, rank: '-', isDead: false, players: [] },
      { name: 'B', totalKills: 2, rank: '-', isDead: false, players: [] },
      { name: 'C', totalKills: 1, rank: '-', isDead: true, players: [] },
    ],
  }));
  assert.equal(mapped.aliveTeams, 2);
  assert.equal(mapped.finished, false);
});

test('a finished match is flagged once one team remains', () => {
  const mapped = mapFeed(scoreboard({
    data: [
      { name: 'A', totalKills: 9, rank: 1, isDead: false, players: [] },
      { name: 'B', totalKills: 4, rank: 2, isDead: true, players: [] },
    ],
  }));
  assert.equal(mapped.finished, true);
});

test('a feed without isDead flags falls back to ranks instead of stalling forever', () => {
  const mapped = mapFeed({
    matchId: 'X', data: [
      { name: 'A', totalKills: 5, rank: 1, players: [] },
      { name: 'B', totalKills: 2, rank: 2, players: [] },
    ],
  });
  assert.equal(mapped.finished, true);
});

test('matchId carries through so re-polls update one match', () => {
  assert.equal(mapFeed(scoreboard()).externalMatchId, 'M-42');
});

test('a native UETMS payload passes straight through', () => {
  const mapped = mapFeed({
    teams: [
      { team: 'A', placement: 1, players: [{ ign: 'x', kills: 3, damage: 500 }] },
      { team: 'B', placement: 2, players: [] },
    ],
  });
  assert.equal(mapped.adapter, 'uetms');
  assert.equal(mapped.teams[0].players[0].damage, 500);
});

test('an unusable payload is rejected with a readable message', () => {
  assert.throws(() => mapFeed({ nothing: true }), /detect feed format/i);
});
