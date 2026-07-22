// Run with:  npm test        (no database, no install needed)
// Covers the feed adapters: format detection, placement derivation, kill-column
// detection and the guards that stop a half-played match from being imported.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapFeed, detectAdapter } from '../src/services/feedAdapters.js';

const team = (name, kills, dead, surv, players, extra = {}) => ({
  name, tag: name.slice(0, 3), logo: `https://cdn.example/${name}.png`,
  totalKills: kills, score: kills, rank: '-', isDead: dead,
  eliminationTime: dead ? 1700000000000 + surv : 0,
  survivalSeconds: surv, survivalTime: '00:00',
  players: players.map(([n, k]) => ({ name: n, knockCount: k, elimCount: 0 })),
  ...extra,
});

const FINISHED = {
  success: true, matchId: 'match_1784714182928_0jiyymssy', timestamp: 1784714409084,
  data: [
    team('TEAM MYTH', 5, false, 0, [['MythDADDY', 1], ['MythDETROX', 1], ['MythLucifer', 1], ['MythARYTON', 0], ['MythHARSHIL', 2]]),
    team('IQOO TT', 7, true, 1694, [['iQOOxTTjusty', 2], ['iQOOxTTReaper', 3], ['iQOOxTTAIMGOD', 2]]),
    team('IQOO RNTX', 11, true, 1646, [['iQOORNTxPAIN', 3], ['iQOORNTxTRACE', 6], ['iQOORNTxPROTON', 1], ['iQOORNTxNINjAJOD', 1]]),
    team('TRUE RIPPERS', 1, true, 179, [['TRxTERMI', 1], ['TRxPUNK', 0]]),
  ],
};

test('detects the scoreboard format automatically', () => {
  assert.equal(detectAdapter(FINISHED), 'tochanparn');
  assert.equal(detectAdapter({ teams: [{ team: 'A', placement: 1 }] }), 'uetms');
  assert.throws(() => detectAdapter({ nope: true }), /Could not detect/);
});

test('carries matchId across as externalMatchId so re-polls update the same match', () => {
  const m = mapFeed(FINISHED);
  assert.equal(m.externalMatchId, 'match_1784714182928_0jiyymssy');
});

test('derives placement: last team alive wins, then longest survivor', () => {
  const m = mapFeed(FINISHED);
  assert.deepEqual(m.teams.map((t) => t.team), ['TEAM MYTH', 'IQOO TT', 'IQOO RNTX', 'TRUE RIPPERS']);
  assert.deepEqual(m.teams.map((t) => t.placement), [1, 2, 3, 4]);
});

test('picks the column that actually holds kills (knockCount here, elimCount is unused)', () => {
  const m = mapFeed(FINISHED);
  assert.equal(m.killField, 'knock');
  for (const t of m.teams) {
    const sum = t.players.reduce((s, p) => s + p.kills, 0);
    assert.equal(sum, t.kills, `${t.team}: player kills must add up to team kills`);
  }
});

test('honours a manual kill-column override', () => {
  const m = mapFeed(FINISHED, { killField: 'elim' });
  assert.equal(m.killField, 'elim');
  assert.equal(m.teams[0].players.reduce((s, p) => s + p.kills, 0), 0);
});

test('uses real numeric ranks when the feed supplies them', () => {
  const ranked = { matchId: 'r1', data: [
    { name: 'X', totalKills: 3, rank: 2, isDead: true, survivalSeconds: 100, players: [{ name: 'x1', elimCount: 3, knockCount: 5 }] },
    { name: 'Y', totalKills: 1, rank: 1, isDead: false, survivalSeconds: 0, players: [{ name: 'y1', elimCount: 1, knockCount: 2 }] },
  ] };
  const m = mapFeed(ranked);
  assert.deepEqual(m.teams.map((t) => t.team), ['Y', 'X']);
  assert.equal(m.killField, 'elim');
  assert.equal(m.teams[1].players[0].knocks, 5); // knocks preserved separately
});

test('flags a match still in progress so it is not imported early', () => {
  const live = { matchId: 'm2', data: [
    team('A', 2, false, 0, [['a1', 2]]),
    team('B', 1, false, 0, [['b1', 1]]),
    team('C', 0, true, 120, [['c1', 0]]),
  ] };
  const m = mapFeed(live);
  assert.equal(m.finished, false);
  assert.equal(m.aliveTeams, 2);
});

test('flags a finished match once one team is left', () => {
  const m = mapFeed(FINISHED);
  assert.equal(m.finished, true);
  assert.equal(m.aliveTeams, 1);
});

test('carries tag and logo through for team auto-creation', () => {
  const m = mapFeed(FINISHED);
  assert.equal(m.teams[0].shortName, 'TEA');
  assert.match(m.teams[0].logoUrl, /^https:\/\/cdn\.example\//);
});

test('falls back to survivalTime when survivalSeconds is missing', () => {
  const m = mapFeed({ matchId: 'x', data: [
    { name: 'Late', totalKills: 0, rank: '-', isDead: true, survivalTime: '28:14', players: [] },
    { name: 'Early', totalKills: 0, rank: '-', isDead: true, survivalTime: '02:59', players: [] },
  ] });
  assert.deepEqual(m.teams.map((t) => t.team), ['Late', 'Early']);
});

test('rejects payloads with nothing usable', () => {
  assert.throws(() => mapFeed({ success: true, data: [] }), /No usable teams/);
  assert.throws(() => mapFeed({ success: true, nothing: 1 }), /Could not detect/);
});

test('passes a native UETMS payload straight through', () => {
  const m = mapFeed({ externalMatchId: 'abc', teams: [
    { team: 'A', placement: 1, kills: 5, players: [{ ign: 'a1', kills: 5 }] },
    { team: 'B', placement: 2, kills: 1, players: [] },
  ] });
  assert.equal(m.adapter, 'uetms');
  assert.equal(m.externalMatchId, 'abc');
  assert.equal(m.teams.length, 2);
});
