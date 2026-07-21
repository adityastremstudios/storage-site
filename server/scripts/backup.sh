#!/bin/sh
# Daily Postgres backup — add to cron: 0 3 * * * /path/to/uetms/server/scripts/backup.sh
# Works both with docker compose (default) and a local pg_dump (set LOCAL=1).
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)/backup"
mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$DIR/uetms-$STAMP.sql.gz"
if [ "$LOCAL" = "1" ]; then
  pg_dump "$DATABASE_URL" | gzip > "$FILE"
else
  docker compose exec -T postgres pg_dump -U uetms uetms | gzip > "$FILE"
fi
echo "backup written: $FILE"
ls -1t "$DIR"/uetms-*.sql.gz | tail -n +15 | xargs -r rm --   # keep last 14
