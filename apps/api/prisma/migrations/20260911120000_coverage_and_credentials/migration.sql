-- CreateTable
CREATE TABLE IF NOT EXISTS "CoverageArea" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" TEXT NOT NULL DEFAULT 'IKORODU',
    "lga" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COVERED',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CoverageArea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CoverageArea_tenantId_idx" ON "CoverageArea"("tenantId");
CREATE INDEX IF NOT EXISTS "CoverageArea_zone_idx" ON "CoverageArea"("zone");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "CoverageArea" ADD CONSTRAINT "CoverageArea_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "Tenant"
    ADD COLUMN IF NOT EXISTS "paystackEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "paystackPublicKey" TEXT,
    ADD COLUMN IF NOT EXISTS "paystackSecretKeyEnc" TEXT,
    ADD COLUMN IF NOT EXISTS "paystackSecretLast4" TEXT,
    ADD COLUMN IF NOT EXISTS "smtpEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "smtpHost" TEXT,
    ADD COLUMN IF NOT EXISTS "smtpPort" INTEGER,
    ADD COLUMN IF NOT EXISTS "smtpUser" TEXT,
    ADD COLUMN IF NOT EXISTS "smtpPassEnc" TEXT,
    ADD COLUMN IF NOT EXISTS "smtpPassLast4" TEXT,
    ADD COLUMN IF NOT EXISTS "smtpFromEmail" TEXT,
    ADD COLUMN IF NOT EXISTS "smtpFromName" TEXT;
