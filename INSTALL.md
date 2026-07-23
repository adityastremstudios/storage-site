# UETMS v2 — install guide

Everything is drop-in. Same paths, same exports, same API shapes.
No existing endpoint removed, no table dropped, no field deleted.

## 1. Back up first

```bash
./server/scripts/backup.sh
```

The schema step changes two constraints. Do not skip this.

## 2. Copy files

**Server**
```
server/prisma/schema.prisma              (replace)
server/prisma/seed-v2.mjs                (new)
server/src/config.js                     (replace)
server/src/lib/crud.js                   (replace)
server/src/middleware/auth.js            (replace)
server/src/routes/connectors.js          (replace)
server/src/routes/media.js               (replace)
server/src/routes/stats.js               (new)
server/src/routes/matchOps.js            (new)
server/src/services/statsEngine.js       (replace)
server/src/services/importService.js     (replace)
server/src/services/feedAdapters.js      (replace)
server/src/services/feedPoller.js        (replace)
server/src/services/analyticsService.js  (new)
server/src/services/recalcService.js     (new)
server/scripts/migrate-apikeys.mjs       (new)
server/test/engine.test.js               (new)
```

**Client**
```
client/src/App.jsx                       (replace)
client/src/components/StatBits.jsx       (new)
client/src/pages/Statistics.jsx          (new)
client/src/pages/Profiles.jsx            (new)
client/src/pages/MatchStats.jsx          (new)
```

## 3. Three hand edits

**`server/src/index.js`** — import guard and CORS:

```js
import { config, assertProductionConfig, corsOrigins } from './config.js';

const app = express();
assertProductionConfig();                    // add
app.use(cors({ origin: corsOrigins() }));    // was config.corsOrigin
```

Register the two new routers next to the existing ones:

```js
import statsRoutes from './routes/stats.js';
import matchOpsRoutes from './routes/matchOps.js';

app.use('/api/stats', statsRoutes);
app.use('/api/match-ops', matchOpsRoutes);
```

**`client/src/components/Layout.jsx`** — add one nav entry after Players:

```js
{ to: '/stats', label: 'Statistics' },
```

## 4. Migrate and seed

```bash
cd server
npx prisma migrate dev --name uetms-v2
node scripts/migrate-apikeys.mjs   # hashes existing keys; they keep working
node prisma/seed-v2.mjs            # stat definitions + achievements + tiebreakers
npm run dev
```

Then, once per tournament:

```
POST /api/stats/recalc  { "tournamentId": 1, "scope": "all" }
```
or press **Recalculate** on the Statistics page.

## 5. Verify

```bash
cd server && node --test tests/adapters.test.mjs test/engine.test.js
# 39 passing — 12 original (backward compat) + 27 new
```

---

## Schema safety

**Additive, zero risk:** 9 new models and every new column. All nullable or
defaulted, so existing rows and queries are untouched.

**Two constraint changes:**

1. `Player.ign` loses its global `@unique`, gains an index.
   Dropping a unique never fails. This is what stopped two different people
   named "Ace" being merged into one player record.

2. `Match.externalMatchId`: global `@unique` → `@@unique([tournamentId, externalMatchId])`.
   Your current data is already globally unique, so it satisfies the narrower
   constraint by definition. Postgres treats NULLs as distinct.

**Deliberately not added:** a DB unique on `[tournamentId, roundId, matchNumber]`.
If your live DB already holds duplicates the migration would fail mid-flight.
Duplicate detection lives in the import pipeline instead, where it reports the
conflict rather than crashing.

---

## Rollback

```bash
psql $DATABASE_URL < backups/<latest>.sql
git checkout -- server/src client/src server/prisma/schema.prisma
```

API keys hashed by the migration keep working after a code rollback only if the
DB is restored too — the plaintext column is overwritten in place.

---

## New API surface

Every existing endpoint is unchanged. These are additions.

**Statistics**
```
GET  /api/stats/players                    ?tournament&sort&minKills&minMatches&country&page&limit
GET  /api/stats/players/:id                ?tournament
GET  /api/stats/players/compare            ?ids=1,2,3&tournament
GET  /api/stats/teams                      ?tournament&sort&minMatches
GET  /api/stats/teams/:id                  ?tournament
GET  /api/stats/teams/compare              ?ids=1,2&tournament
GET  /api/stats/matches/:id
GET  /api/stats/rounds/:id
GET  /api/stats/tournaments/:id
GET  /api/stats/records                    ?tournament
GET  /api/stats/achievements               ?tournament&player
GET  /api/stats/caster/:tournamentId       ?team&player
POST /api/stats/recalc                     { tournamentId, scope, roundId?, matchId? }
GET  /api/stats/recalc/jobs                ?tournament
```

`scope` is one of: `match`, `round`, `tournament`, `players`, `teams`,
`records`, `achievements`, `all`.

**Match operations**
```
POST   /api/match-ops/:id/lock | /unlock | /publish | /unpublish
POST   /api/match-ops/:id/archive | /unarchive | /clone | /reimport | /recalc
GET    /api/match-ops/:id/duplicates
PATCH  /api/match-ops/:id/meta                        { notes, tags }
GET    /api/match-ops/:id/versions
GET    /api/match-ops/:id/versions/:version
GET    /api/match-ops/:id/versions/compare            ?a=1&b=2
POST   /api/match-ops/:id/versions/:version/restore
PATCH  /api/match-ops/:id/team-stats/:teamId          { values, reason }
PATCH  /api/match-ops/:id/player-stats/:playerId      { values, reason }
POST   /api/match-ops/:id/clear-overrides
GET    /api/match-ops/:id/penalties
POST   /api/match-ops/:id/penalties                   { teamId, points, reason }
DELETE /api/match-ops/penalties/:penaltyId
POST   /api/connectors/:id/rotate
```

---

## How manual overrides work

This is the mechanism behind AUTO FIRST / MANUAL ALWAYS.

```
PATCH /api/match-ops/12/player-stats/45
{ "values": { "kills": 8 }, "reason": "Scoreboard missed a frag at 14:32" }
```

- The value goes into `PlayerStat.overrides`, not just the column.
- `applyStats` merges overrides **on top of** every future import, so the next
  feed poll cannot wipe the correction.
- The row is marked `source: MANUAL` and shows an "edited" badge in the UI.
- `reason` is mandatory and lands in the audit log with before/after and actor.
- Send `"kills": null` to clear that one override and restore the imported value.
- `POST /clear-overrides` clears everything on the match and rebuilds from the
  last stored payload — that is the Undo.

## Absent vs zero

Your feed sends no damage today. Every damage field exists in the schema and in
the UI, but a stat the source never sent is stored as **not provided**, not as
`0`. So:

- averages skip it instead of dividing by a fake zero
- records skip it instead of publishing "Highest Damage: 0" on the overlay
- the UI shows `—`
- leaderboards for an unsupplied stat come back empty with
  "The feed does not supply this stat" rather than a table of zeroes

The day the game API arrives, the values start flowing in and every page fills
itself. No schema change, no code change.
