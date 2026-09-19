-- Add payment gateway selection and Flutterwave credentials
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "paymentProvider" TEXT NOT NULL DEFAULT 'PAYSTACK';
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "flutterwaveEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "flutterwavePublicKey" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "flutterwaveSecretKeyEnc" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "flutterwaveSecretLast4" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "flutterwaveWebhookSecretEnc" TEXT;
