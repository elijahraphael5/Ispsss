-- Batch 7: Move CoverageZone default seeding from on-read to migration
-- Previously CoverageZonesService.list() inserted the 4 static zones on every read.
-- This migration seeds them once per tenant (idempotent) and the service now does a plain findMany.

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Seed 4 default zones per tenant where not already present (including soft-deleted check via raw)
INSERT INTO "CoverageZone" ("id", "tenantId", "slug", "label", "createdAt", "updatedAt", "deletedAt")
SELECT gen_random_uuid()::text, t.id, 'LAGOS_MAINLAND', 'Lagos Mainland', NOW(), NOW(), NULL
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "CoverageZone" cz WHERE cz."tenantId" = t.id AND cz.slug = 'LAGOS_MAINLAND')
ON CONFLICT DO NOTHING;

INSERT INTO "CoverageZone" ("id", "tenantId", "slug", "label", "createdAt", "updatedAt", "deletedAt")
SELECT gen_random_uuid()::text, t.id, 'LAGOS_ISLAND', 'Lagos Island', NOW(), NOW(), NULL
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "CoverageZone" cz WHERE cz."tenantId" = t.id AND cz.slug = 'LAGOS_ISLAND')
ON CONFLICT DO NOTHING;

INSERT INTO "CoverageZone" ("id", "tenantId", "slug", "label", "createdAt", "updatedAt", "deletedAt")
SELECT gen_random_uuid()::text, t.id, 'IKORODU', 'Ikorodu', NOW(), NOW(), NULL
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "CoverageZone" cz WHERE cz."tenantId" = t.id AND cz.slug = 'IKORODU')
ON CONFLICT DO NOTHING;

INSERT INTO "CoverageZone" ("id", "tenantId", "slug", "label", "createdAt", "updatedAt", "deletedAt")
SELECT gen_random_uuid()::text, t.id, 'OTHER', 'Other', NOW(), NOW(), NULL
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "CoverageZone" cz WHERE cz."tenantId" = t.id AND cz.slug = 'OTHER')
ON CONFLICT DO NOTHING;
