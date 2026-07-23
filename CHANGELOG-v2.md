# UETMS v2 — what changed

Everything below is already applied in this project. No hand edits needed.

## Files replaced (13)

```
server/prisma/schema.prisma
server/src/index.js                      (wiring only)
server/src/config.js
server/src/lib/crud.js
server/src/middleware/auth.js
server/src/routes/connectors.js
server/src/routes/media.js
server/src/services/statsEngine.js
server/src/services/importService.js
server/src/services/feedAdapters.js
server/src/services/feedPoller.js
server/package.json                      (scripts only)
client/src/App.jsx
client/src/components/Layout.jsx         (one nav row)
```

## Files added (11)

```
server/prisma/seed-v2.mjs
server/scripts/migrate-apikeys.mjs
server/src/routes/stats.js
server/src/routes/matchOps.js
server/src/services/analyticsService.js
server/src/services/recalcService.js
server/test/engine.test.js
client/src/components/StatBits.jsx
client/src/pages/Statistics.jsx
client/src/pages/Profiles.jsx
client/src/pages/MatchStats.jsx
```

Nothing was deleted. Every original file not listed above is byte-identical.

## First run

```bash
./server/scripts/backup.sh          # back up before migrating

cd server
npm install
npx prisma migrate dev --name uetms-v2
npm run migrate:apikeys             # hash existing keys — they keep working
npm run db:seed:v2                  # stat definitions, achievements, tiebreakers
npm test                            # 39 passing
npm run dev

cd ../client && npm install && npm run dev
```

Then per tournament: press **Recalculate** on the Statistics page, or

```
POST /api/stats/recalc { "tournamentId": 1, "scope": "all" }
```

## Bugs fixed

| # | Bug | Impact before |
|---|-----|---------------|
| 1 | `externalMatchId` looked up globally | Two tournaments sending `matchId:"5"` overwrote each other |
| 2 | API keys stored + returned in plaintext | Any CASTER account could read every key and push fake data |
| 3 | JWT secrets defaulted to `dev-access-secret` | Deploy without `.env` → anyone forges a SUPER_ADMIN token |
| 4 | `Player.ign` globally unique | Two players named "Ace" merged into one, careers combined |
| 5 | Live feed key embedded the payload hash | Every 20s poll created a brand new match |
| 6 | `f_*` filters written straight into `where` | `f_deletedAt` bypassed soft delete on every model |
| 7 | Upload filter trusted client mimetype | `evil.html` as `image/png` → stored XSS on the admin origin |
| 8 | `applyStats` deleted all stats each import | A manual fix was wiped by the next poll |
| 9 | Unlock cleared `isLocked`, left `status: LOCKED` | Match stuck in a dead state |
| 10 | `publishMatch` never checked `isLocked` | Publish bypassed the lock |
| 11 | Moving a match left the old round stale | Round standings silently wrong |
| 12 | Teams/players created outside the transaction | Failed import left orphan rows |
| 13 | `recalcStandings` read outside its transaction | Two feeds interleaved, last write won with stale numbers |
| 14 | Team `survivalTime` stripped by the zod schema | Survival records impossible |
| 15 | Player `survivalTime` never mapped | Same |
| 16 | `knocks` forced to 0 when knockCount held kills | "Top Knockdowns" permanently zero |
| 17 | Missing stats stored as `0` | "Highest Damage: 0" on the broadcast overlay |
| 18 | `new Date(timestamp)` with no unit detection | Epoch-seconds feeds dated 1970 |
| 19 | Push imports wrote nothing to the audit log | No import history |
| 20 | `overlay_outputs` grew unbounded | ~540 rows/hour/tournament on a 20s feed |

## Spec delivered

**Match module** — duplicate detection, re-import, clone, archive/unarchive,
lock/unlock, publish/unpublish, notes, tags, import history, version history
with compare + restore.

**Statistics Center** — player, team, tournament, round and match statistics,
each with filters, export and recalculation.

**Profiles** — player profile with all 22 spec fields, team profile with roster
and contribution split, best/worst match, recent form.

**Comparison** — players and teams, 2 to 4 at a time, with a trend chart and
per-metric winner highlighting.

**Records** — 9 record types at both tournament and all-time scope.

**Achievements** — 12 seeded rules, thresholds editable in the database.

**Recalculation engine** — match, round, tournament, players, teams, records,
achievements, or all; serialised by a Postgres advisory lock and logged as a
`RecalcJob`.

**Caster panel** — rule-based insight lines, no external service, works offline
at the venue. Auto-refreshes every 30s, per-line copy button.

**History** — every edit, import, publish, delete and restore in `audit_logs`
with actor, before/after and a mandatory reason on manual overrides.

## Added beyond the spec

- **Penalty ledger** — teamkill / late / DC / cheating deductions at team-match
  level, applied during recalculation, shown in standings.
- **Configurable tiebreakers** — ordered chain per point rule, and the
  standings row records *which rule* broke the tie.
- **Manual override layer** — the mechanism behind AUTO FIRST / MANUAL ALWAYS.
- **`provided` tracking** — absent stats stay absent instead of becoming a fake
  zero that poisons averages and records.
- **Multi-game hook** — `Game.format` + `StatDefinition` rows. BR is unchanged;
  Valorant/CS2 plug in by adding rows, not rewriting engines.
- **Connector scoping** — an API key can be restricted to named tournaments.
- **Key rotation** — `POST /api/connectors/:id/rotate`.

## Known gaps

- Excel and image export are not implemented. CSV opens in Excel; browser print
  covers PDF.
- The H2H (Valorant/CS2) scoring engine is scaffolded but not written — series,
  map veto, rounds-won and ACS/ADR/KAST still need building.
- No DB-level unique on `[tournamentId, roundId, matchNumber]`; duplicate
  detection is done in the import pipeline so it reports rather than crashes.

---

## Deploy notes (Render / Docker)

### `prisma db push` refuses with "There might be data loss"

The v2 schema adds three unique constraints. Prisma cannot verify they are safe
without reading your data, so it stops. All three are safe:

| Constraint | Why it cannot conflict |
|---|---|
| `api_connectors.apiKeyHash` | Brand-new column, every existing row is NULL, and Postgres treats NULLs as distinct |
| `matches [tournamentId, externalMatchId]` | `externalMatchId` was already globally unique, so it is unique within any subset by definition |
| `players.externalId` | Brand-new column, all NULL |

Verified against the original schema: **0 dropped models, 0 dropped fields,
0 new required columns.**

Run `server/scripts/preflight.sql` if you want to confirm on your own data —
all three checks must return `conflicts = 0`.

The included `docker-entrypoint.sh` passes `--accept-data-loss` for this reason.

**After this deploy succeeds, switch to real migrations.** `--accept-data-loss`
is permanent in the entrypoint and will silently accept genuinely destructive
changes later:

```bash
npx prisma migrate dev --name uetms-v2      # locally, generates SQL
git add prisma/migrations && git commit
# then change the entrypoint line to:
npx prisma migrate deploy
```

### Required environment variables

`Dockerfile` sets `NODE_ENV=production`, so `assertProductionConfig()` runs and
the server refuses to boot without these:

| Variable | Requirement |
|---|---|
| `DATABASE_URL` | Must be set |
| `JWT_SECRET` | 32+ chars, not the dev default |
| `JWT_REFRESH_SECRET` | Must differ from `JWT_SECRET` |
| `ADMIN_PASSWORD` | Not `Admin@123` |

Generate each secret separately:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`CORS_ORIGIN` is a warning rather than a failure: this API authenticates with
Bearer tokens, not cookies, so a permissive origin does not by itself hand an
attacker anything. Set it to your real origin anyway.

Without these the boot log prints exactly which variables are wrong and exits 1.
That is the guard working, not a crash.
