-- Add PHPRadius spec fields: legacyId, hikonnectId, stationLabel, secondaryPhone, Cpe flags
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "secondaryPhone" TEXT;
ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "legacyId" TEXT;
ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "hikonnectId" TEXT;
ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "stationLabel" TEXT;
ALTER TABLE "Cpe" ADD COLUMN IF NOT EXISTS "needsMacAddress" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Cpe" ADD COLUMN IF NOT EXISTS "ipConflict" BOOLEAN NOT NULL DEFAULT false;
-- Unique for hikonnectId where not null
CREATE UNIQUE INDEX IF NOT EXISTS "Subscriber_hikonnectId_key" ON "Subscriber"("hikonnectId") WHERE "hikonnectId" IS NOT NULL;
-- Indexes for filtering
CREATE INDEX IF NOT EXISTS "Subscriber_legacyId_idx" ON "Subscriber"("legacyId");
CREATE INDEX IF NOT EXISTS "Subscriber_stationLabel_idx" ON "Subscriber"("stationLabel");
CREATE INDEX IF NOT EXISTS "Cpe_needsMacAddress_idx" ON "Cpe"("needsMacAddress");
