-- Batch 7: deletedAt indexes + soft-delete-aware unique constraints

-- 0. Create CoverageZone table if missing (schema added in 9b9d524 but no CREATE TABLE migration existed)
-- This must run before any CoverageZone index; previous deploys failed here with "relation CoverageZone does not exist"
CREATE TABLE IF NOT EXISTS "CoverageZone" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "CoverageZone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CoverageZone_tenantId_slug_key" ON "CoverageZone"("tenantId", "slug");
CREATE INDEX IF NOT EXISTS "CoverageZone_tenantId_idx" ON "CoverageZone"("tenantId");
DO $$ BEGIN
    ALTER TABLE "CoverageZone" ADD CONSTRAINT "CoverageZone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 1. DeletedAt indexes for fast WHERE "deletedAt" IS NULL filtering (every soft-delete read)
CREATE INDEX IF NOT EXISTS "User_deletedAt_idx" ON "User"("deletedAt");
CREATE INDEX IF NOT EXISTS "Subscriber_deletedAt_idx" ON "Subscriber"("deletedAt");
CREATE INDEX IF NOT EXISTS "Plan_deletedAt_idx" ON "Plan"("deletedAt");
CREATE INDEX IF NOT EXISTS "Subscription_deletedAt_idx" ON "Subscription"("deletedAt");
CREATE INDEX IF NOT EXISTS "Invoice_deletedAt_idx" ON "Invoice"("deletedAt");
CREATE INDEX IF NOT EXISTS "InvoiceLine_deletedAt_idx" ON "InvoiceLine"("deletedAt");
CREATE INDEX IF NOT EXISTS "Payment_deletedAt_idx" ON "Payment"("deletedAt");
CREATE INDEX IF NOT EXISTS "Receipt_deletedAt_idx" ON "Receipt"("deletedAt");
CREATE INDEX IF NOT EXISTS "CreditNote_deletedAt_idx" ON "CreditNote"("deletedAt");
CREATE INDEX IF NOT EXISTS "Refund_deletedAt_idx" ON "Refund"("deletedAt");
CREATE INDEX IF NOT EXISTS "Wallet_deletedAt_idx" ON "Wallet"("deletedAt");
CREATE INDEX IF NOT EXISTS "WalletTransaction_deletedAt_idx" ON "WalletTransaction"("deletedAt");
CREATE INDEX IF NOT EXISTS "Quotation_deletedAt_idx" ON "Quotation"("deletedAt");
CREATE INDEX IF NOT EXISTS "QuotationItem_deletedAt_idx" ON "QuotationItem"("deletedAt");
CREATE INDEX IF NOT EXISTS "Ticket_deletedAt_idx" ON "Ticket"("deletedAt");
CREATE INDEX IF NOT EXISTS "TicketComment_deletedAt_idx" ON "TicketComment"("deletedAt");
CREATE INDEX IF NOT EXISTS "ChatSession_deletedAt_idx" ON "ChatSession"("deletedAt");
CREATE INDEX IF NOT EXISTS "ChatMessage_deletedAt_idx" ON "ChatMessage"("deletedAt");
CREATE INDEX IF NOT EXISTS "FileUpload_deletedAt_idx" ON "FileUpload"("deletedAt");
CREATE INDEX IF NOT EXISTS "CannedResponse_deletedAt_idx" ON "CannedResponse"("deletedAt");
CREATE INDEX IF NOT EXISTS "Cpe_deletedAt_idx" ON "Cpe"("deletedAt");
CREATE INDEX IF NOT EXISTS "NetworkDevice_deletedAt_idx" ON "NetworkDevice"("deletedAt");
CREATE INDEX IF NOT EXISTS "CoverageArea_deletedAt_idx" ON "CoverageArea"("deletedAt");
CREATE INDEX IF NOT EXISTS "CoverageZone_deletedAt_idx" ON "CoverageZone"("deletedAt");
CREATE INDEX IF NOT EXISTS "CustomRole_deletedAt_idx" ON "CustomRole"("deletedAt");
CREATE INDEX IF NOT EXISTS "Permission_deletedAt_idx" ON "Permission"("deletedAt");
CREATE INDEX IF NOT EXISTS "Contract_deletedAt_idx" ON "Contract"("deletedAt");
CREATE INDEX IF NOT EXISTS "AuditLog_deletedAt_idx" ON "AuditLog"("deletedAt");
CREATE INDEX IF NOT EXISTS "Notification_deletedAt_idx" ON "Notification"("deletedAt");
CREATE INDEX IF NOT EXISTS "Tenant_deletedAt_idx" ON "Tenant"("deletedAt");
CREATE INDEX IF NOT EXISTS "VirtualAccount_deletedAt_idx" ON "VirtualAccount"("deletedAt");
CREATE INDEX IF NOT EXISTS "PaymentAttempt_deletedAt_idx" ON "PaymentAttempt"("deletedAt");
CREATE INDEX IF NOT EXISTS "PaymentReconciliation_deletedAt_idx" ON "PaymentReconciliation"("deletedAt");
CREATE INDEX IF NOT EXISTS "RouterHealth_deletedAt_idx" ON "RouterHealth"("deletedAt");
CREATE INDEX IF NOT EXISTS "RouterSnapshot_deletedAt_idx" ON "RouterSnapshot"("deletedAt");
CREATE INDEX IF NOT EXISTS "RouterMetric_deletedAt_idx" ON "RouterMetric"("deletedAt");
CREATE INDEX IF NOT EXISTS "RouterUsageDay_deletedAt_idx" ON "RouterUsageDay"("deletedAt");
CREATE INDEX IF NOT EXISTS "PppoeSession_deletedAt_idx" ON "PppoeSession"("deletedAt");
CREATE INDEX IF NOT EXISTS "RefreshToken_deletedAt_idx" ON "RefreshToken"("deletedAt");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_deletedAt_idx" ON "PasswordResetToken"("deletedAt");
CREATE INDEX IF NOT EXISTS "ActionQueue_deletedAt_idx" ON "ActionQueue"("deletedAt");
CREATE INDEX IF NOT EXISTS "AgentPresence_deletedAt_idx" ON "AgentPresence"("deletedAt");

-- Partial deletedAt NULL index (more selective) for hot Invoice/Subscriber reads
CREATE INDEX IF NOT EXISTS "Invoice_deletedAt_null_idx" ON "Invoice"("deletedAt") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Subscriber_deletedAt_null_idx" ON "Subscriber"("deletedAt") WHERE "deletedAt" IS NULL;

-- 2. Soft-delete-aware UNIQUE: allow reusing email/phone/pppoe/ip/mac after soft delete
-- Drop the old DB-level UNIQUE constraints (Prisma will also try via schema diff)
DROP INDEX IF EXISTS "User_email_key";
DROP INDEX IF EXISTS "User_phone_key";
DROP INDEX IF EXISTS "Subscriber_pppoeUsername_key";
DROP INDEX IF EXISTS "Subscriber_staticIpAddress_key";
DROP INDEX IF EXISTS "NetworkDevice_ipAddress_key";
DROP INDEX IF EXISTS "Cpe_macAddress_key";

-- Recreate as partial unique WHERE deletedAt IS NULL (live rows only)
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_partial" ON "User"("email") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_partial" ON "User"("phone") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Subscriber_pppoeUsername_partial" ON "Subscriber"("pppoeUsername") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Subscriber_staticIpAddress_partial" ON "Subscriber"("staticIpAddress") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "NetworkDevice_ipAddress_partial" ON "NetworkDevice"("ipAddress") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Cpe_macAddress_partial" ON "Cpe"("macAddress") WHERE "deletedAt" IS NULL;
