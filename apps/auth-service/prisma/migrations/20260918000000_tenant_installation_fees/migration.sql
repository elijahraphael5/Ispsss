-- Add Tenant installation fee defaults (schema added fiberInstallationFeeKobo/radioInstallationFeeKobo in 9b9d524 but no migration)
-- Fixes P2022: The column `fiberInstallationFeeKobo` does not exist in the current database. (seed-prod.ts Tenant upsert)
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "fiberInstallationFeeKobo" INTEGER NOT NULL DEFAULT 5000000;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "radioInstallationFeeKobo" INTEGER NOT NULL DEFAULT 12000000;
