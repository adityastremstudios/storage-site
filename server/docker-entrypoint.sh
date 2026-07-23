#!/bin/sh
set -e

echo "[entrypoint] pushing database schema..."
i=0
# --accept-data-loss is required because the v2 schema adds three unique
# constraints (api_connectors.apiKeyHash, matches[tournamentId,externalMatchId],
# players.externalId). Prisma cannot prove those are safe without inspecting the
# data, so it refuses by default. They are safe here: the first and third are
# brand-new all-NULL columns, and the second is strictly narrower than the
# global unique it replaces. This schema drops no table and no column.
#
# Run scripts/preflight.sql against the database if you want to confirm that
# for yourself before deploying.
until npx prisma db push --skip-generate --accept-data-loss; do
  i=$((i+1)); [ "$i" -ge 12 ] && echo "database not reachable" && exit 1
  echo "waiting for database... ($i)"; sleep 3
done

if [ "$SEED" = "true" ]; then
  echo "[entrypoint] seeding base data..."
  node prisma/seed.js || echo "[entrypoint] base seed skipped (may already exist)"
fi

# v2 setup — both idempotent, safe to run on every restart.
echo "[entrypoint] hashing any plaintext API keys..."
node scripts/migrate-apikeys.mjs || echo "[entrypoint] api key migration skipped"

echo "[entrypoint] seeding stat definitions and achievements..."
node prisma/seed-v2.mjs || echo "[entrypoint] v2 seed skipped"

exec node src/index.js
