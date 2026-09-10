-- AlterTable
ALTER TABLE "Subscriber" ADD COLUMN "kycSubmittedById" TEXT,
ADD COLUMN "kycSubmittedAt" TIMESTAMP(3),
ADD COLUMN "kycApprovedById" TEXT,
ADD COLUMN "kycApprovedAt" TIMESTAMP(3),
ADD COLUMN "kycRejectedById" TEXT,
ADD COLUMN "kycRejectedAt" TIMESTAMP(3),
ADD COLUMN "kycRejectReason" TEXT;
