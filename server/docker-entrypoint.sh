#!/bin/sh
set -e
echo "[entrypoint] pushing database schema..."
i=0
until npx prisma db push --skip-generate; do
  i=$((i+1)); [ "$i" -ge 12 ] && echo "database not reachable" && exit 1
  echo "waiting for database... ($i)"; sleep 3
done
if [ "$SEED" = "true" ]; then
  echo "[entrypoint] seeding..."
  node prisma/seed.js || echo "[entrypoint] seed skipped/failed (may already exist)"
fi
exec node src/index.js
