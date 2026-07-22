# UETMS — Universal Esports Tournament Management System

Full-stack tournament platform: **React admin panel + Node/Express API + PostgreSQL (Prisma) + Redis cache (optional) + Socket.IO live refresh + OBS/vMix broadcast overlays + public tournament website + auto-import API**.

Built for BR titles (BGMI / PUBG Mobile / Free Fire) but game-agnostic — Valorant/CS2 also seeded. Every part of the 20-phase spec is implemented, plus the addons listed at the bottom.

---

## 1. Quick start (Docker — recommended)

```bash
cp .env.example .env        # optionally edit secrets
docker compose up -d --build
```

Wait ~30s on first boot (DB push + seed), then open:

| URL | What |
|---|---|
| `http://localhost:4000/` | Public tournament website |
| `http://localhost:4000/admin` | Admin panel |
| `http://localhost:4000/overlay/` | Broadcast overlay directory (copy URLs for OBS/vMix) |
| `http://localhost:4000/api/health` | Health check |

**Login:** `admin@uetms.local` (or username `admin`) / `Admin@123`

Seed creates a LIVE demo tournament **"UETMS Championship 2026"** with 16 teams, 64 players and 3 published matches — standings, top fraggers, MVP, overlays and the public site all have data immediately.

## 2. Local development (no Docker for the app)

```bash
docker compose up -d postgres redis     # just the databases

cd server
cp ../.env.example .env
npm install
npx prisma db push
npm run seed
npm run dev                             # API + public site + overlays on :4000

cd ../client
npm install
npm run dev                             # admin panel on :5173 (proxies /api → :4000)
```

Production build of the admin panel: `cd client && npm run build` → served automatically by the server from `client/dist` (or `server/public/admin` inside Docker).

## 3. Roles (RBAC)

`SUPER_ADMIN > ADMIN > TOURNAMENT_MANAGER > DATA_ENTRY > OBSERVER / CASTER > READ_ONLY`

| Capability | Min role |
|---|---|
| Users, connectors (API keys), audit log | SUPER_ADMIN / ADMIN |
| Create/edit tournaments, rounds, teams, players, games, point rules, feeds | TOURNAMENT_MANAGER |
| Enter/import match stats, publish/lock matches, run feeds, recalc | DATA_ENTRY |
| View admin dashboards & overlay links | OBSERVER / CASTER |
| Public site & overlays | no login needed |

Auth = JWT access (15m) + refresh (30d) with tokenVersion revocation; login is rate-limited.

## 4. Auto-import API (Phase 9 pipeline)

Create a connector in **Admin → Connectors** → you get a one-time API key (`uet_…`).

```bash
curl -X POST http://localhost:4000/api/import/match \
  -H "Content-Type: application/json" \
  -H "x-api-key: uet_YOUR_KEY" \
  -d '{
    "tournament": "uetms-championship-2026",
    "round": "Day 1",
    "externalMatchId": "scrim-2026-07-22-m4",
    "map": "Erangel",
    "autoPublish": true,
    "teams": [
      {
        "team": "Void Sentinels",
        "placement": 1,
        "players": [
          { "ign": "VSAce", "kills": 6, "damage": 812, "knocks": 4, "assists": 2 },
          { "ign": "VSRex", "kills": 3, "damage": 540 }
        ]
      },
      { "team": "Crimson Wolves", "placement": 2, "kills": 7 }
    ]
  }'
```

Pipeline: validate (zod) → resolve/auto-create teams & players → apply stats in a transaction → compute points from the tournament's point rule → recalc standings → bump cache version → Socket.IO `refresh` to overlays + public site.

- **Idempotent**: same `externalMatchId` re-imports update the match instead of duplicating.
- Locked matches return **423** and are never overwritten.
- Team kills optional (auto-summed from players). `GET /api/import/sample-payload` returns a template.
- Manual entry UI (Admin → tournament → match → *Enter stats*) reuses the exact same pipeline.

## 5. Auto Feeds — pull mode (UETMS reads your site by itself)

Section 4 is *push* (your server calls UETMS). **Feeds are pull**: UETMS polls a JSON URL on a timer and imports it automatically — no code needed on your side.

**Admin → Auto Feeds → New feed**

| Field | Example |
|---|---|
| Feed URL | `https://tochanparn.space/api/final-data` |
| Format | Auto-detect |
| Tournament / Round | pick one · `Day 1` (created if missing) |
| Check every | `20` seconds |
| Import when | *Match finished (1 team left)* — or *Every change* for live standings |
| Player kills come from | Auto-detect |

Hit **Test feed** first — it fetches the URL and shows the exact standings, placements and per-player kills that would be imported, without saving anything. Then **Save** and the feed starts polling.

**What the adapter handles for the `{success, matchId, data:[…]}` scoreboard format:**

- `matchId` → `externalMatchId`, so re-polling the same match **updates** it instead of creating duplicates.
- `rank: "-"` → placement is derived the BR way: teams still alive rank first, then dead teams ordered by `survivalSeconds` (longest survivor placed higher). WWCD = the last team standing.
- Kill column is auto-detected: it compares each team's `totalKills` against the sum of `knockCount` vs `elimCount` per player and picks whichever actually matches (your feed counts frags in `knockCount`, so that is used). Override manually if needed.
- `team.tag` → short name, `team.logo` → team logo (saved the first time), `timestamp` → match time.
- Unchanged payloads are skipped (SHA-1 of the mapped data), so polling every 20s costs nothing.
- Locked matches are never overwritten; errors are retried on the next tick and written to the feed's **Logs**.

**Live mode.** With *Import when → Every change*, standings update while the match is still being played: stats count immediately, but the match stays "open" (`endedAt` empty) so the match-result and lower-third overlays keep showing it as LIVE until the last team dies. With *Match finished* (default) nothing is written until one team is left standing.

Each feed row shows live status (`imported` / `waiting` / `unchanged` / `error`), last message, import count and **Run now** / **Pause** buttons. Active feeds also appear on the Dashboard with their latest result, and every poll is written to the feed's Logs.

Verify a format change without a database: `cd server && npm test` runs the adapter suite (placement derivation, kill-column detection, live/finished guards).

API: `GET /api/feeds` · `POST /api/feeds` · `POST /api/feeds/test` · `POST /api/feeds/:id/run` · `POST /api/feeds/:id/toggle` · `GET /api/feeds/:id/logs`

## 6. Broadcast overlays (OBS / vMix browser source)

Open `http://localhost:4000/overlay/` for a click-to-copy directory. Base URLs:

| Overlay | URL |
|---|---|
| Overall standings | `/overlay/overall.html?t=<slug>` |
| Top fraggers | `/overlay/topfraggers.html?t=<slug>` |
| Match result (WWCD card) | `/overlay/matchresult.html?t=<slug>` (`&m=<matchId>` to force one) |
| Lower third | `/overlay/lowerthird.html?t=<slug>` (`&text=...&sub=...` manual) |

Common params: `round=<roundId>` filter, `limit=`, `title=`, `accent=%23F0B429`, `bg=green` (chroma key) or `bg=dark`. Overlays auto-refresh via Socket.IO the moment a match is published (25s polling fallback).

## 7. Public JSON API & reports

Base: `/api/public/…` (no auth, cached, versioned per tournament)

`/tournaments` · `/t/:slug` · `/t/:slug/overall?round=` · `/t/:slug/topfraggers?limit=` · `/t/:slug/mvp` · `/t/:slug/matches` · `/t/:slug/matches/:id` · `/t/:slug/teams` · `/t/:slug/players` · `/t/:slug/live` · `/t/:slug/schedule` · `/t/:slug/h2h?a=&b=`

CSV/JSON exports: `/api/reports/:slug/overall|topfraggers|matches?format=csv`

## 8. Points, tiebreakers, MVP

- Point rules are editable per game (Admin → Games): placement points list + per-kill points. Default: SUPER standard `10,6,5,4,3,2,1,1` + 1/kill.
- Standings tiebreakers: total points → WWCD count → placement points → kills → best recent placement.
- MVP score: `kills×12 + damage×0.08 + assists×6 + knocks×3 + revives×5 + headshots×2`.
- Only `COMPLETED / PUBLISHED / LOCKED` matches count; standings recalc is automatic and also available as a button.

## 9. Backups

```bash
./server/scripts/backup.sh          # pg_dump via docker compose → server/backup/, keeps last 14
# cron: 0 3 * * * cd /path/to/uetms && ./server/scripts/backup.sh
```

## 10. Environment variables

See `.env.example` — `DATABASE_URL`, `REDIS_URL` (optional; in-memory fallback), `PORT`, `CORS_ORIGIN`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SEED`, `ADMIN_EMAIL/USERNAME/PASSWORD`.

## 11. Addons beyond the spec

Auto Feeds / pull-mode polling with adapters, placement derivation, kill-column auto-detection, dry-run preview and per-feed logs · adapter test suite · idempotent re-imports · deterministic tiebreakers · refresh tokens + tokenVersion revocation · login rate limiting · zod validation · soft delete + restore · full audit trail (before/after JSON) · Redis-optional caching with per-tournament versioning · Socket.IO live refresh (overlays + public site) · manual stats UI reusing the import pipeline · player transfer history + `/players/:id/history` · head-to-head endpoint · tournament clone & archive · overlay link generator per tournament · media uploads · global search · CSV exports · seeded demo data · one-command Docker deploy · backup script.

## Verification note

All server files pass `node --check`, shell scripts pass `bash -n`, the Prisma schema's models and relations were checked structurally, and the React admin builds cleanly (`vite build`). The feed adapters have a 12-case test suite (`npm test`, all passing), and the full poll → map → import → points → publish pipeline was exercised end-to-end against a mock endpoint, including the still-live, unchanged-payload, locked-match, bad-JSON, HTTP-error and unreachable-host paths. Actual Postgres boot (Prisma engine download) happens inside `docker compose up --build`, which is the intended run path.
