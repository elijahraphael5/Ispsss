-- Make legacyId unique where not null (auto-generated HIF/HIR sequence)
-- Deduplicate existing duplicates by nulling later rows (keeps first per legacyId)
WITH ranked AS (
  SELECT id, "legacyId",
         ROW_NUMBER() OVER (PARTITION BY "legacyId" ORDER BY "createdAt", id) as rn
  FROM "Subscriber" WHERE "legacyId" IS NOT NULL AND "legacyId" <> ''
)
UPDATE "Subscriber" SET "legacyId" = NULL WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Drop old non-unique index if exists
DROP INDEX IF EXISTS "Subscriber_legacyId_idx";
-- Create unique index where not null (Prisma @unique for String? in Postgres)
CREATE UNIQUE INDEX IF NOT EXISTS "Subscriber_legacyId_key" ON "Subscriber"("legacyId") WHERE "legacyId" IS NOT NULL;
