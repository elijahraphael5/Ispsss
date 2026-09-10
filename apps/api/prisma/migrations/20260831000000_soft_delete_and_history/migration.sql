-- Soft delete everywhere: add deletedAt to the 20 models that lacked it,
-- and create the append-only EntityHistory table that mirrors every
-- UPDATE/DELETE on business models (before/after JSON snapshots).

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Permission" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "QuotationItem" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "VirtualAccount" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "PaymentAttempt" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "PaymentReconciliation" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "TicketComment" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "ChatMessage" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "FileUpload" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "AgentPresence" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "RouterHealth" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "RefreshToken" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "AuditLog" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "PasswordResetToken" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "ActionQueue" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "RouterSnapshot" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "RouterMetric" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "RouterUsageDay" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "PppoeSession" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EntityHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "model" TEXT NOT NULL,
    "recordId" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityHistory_model_recordId_createdAt_idx" ON "EntityHistory"("model", "recordId", "createdAt");
CREATE INDEX "EntityHistory_model_createdAt_idx" ON "EntityHistory"("model", "createdAt");
CREATE INDEX "EntityHistory_tenantId_createdAt_idx" ON "EntityHistory"("tenantId", "createdAt");
