-- Run these BEFORE accepting. Every one must return 0 rows.

-- 1. api_connectors.apiKeyHash unique
--    Brand-new column: every existing row is NULL, and Postgres treats NULLs as
--    distinct in a unique index. Cannot conflict.
SELECT 'apiKeyHash' AS check, COUNT(*) AS conflicts FROM (
  SELECT "apiKeyHash" FROM api_connectors
  WHERE "apiKeyHash" IS NOT NULL
  GROUP BY "apiKeyHash" HAVING COUNT(*) > 1
) x;

-- 2. matches [tournamentId, externalMatchId] unique
--    externalMatchId was already globally unique, so it is unique within any
--    subset by definition.
SELECT 'matches scoped' AS check, COUNT(*) AS conflicts FROM (
  SELECT "tournamentId", "externalMatchId" FROM matches
  WHERE "externalMatchId" IS NOT NULL
  GROUP BY "tournamentId", "externalMatchId" HAVING COUNT(*) > 1
) x;

-- 3. players.externalId unique
--    Brand-new column, all NULL.
SELECT 'players externalId' AS check, COUNT(*) AS conflicts FROM (
  SELECT "externalId" FROM players
  WHERE "externalId" IS NOT NULL
  GROUP BY "externalId" HAVING COUNT(*) > 1
) x;
