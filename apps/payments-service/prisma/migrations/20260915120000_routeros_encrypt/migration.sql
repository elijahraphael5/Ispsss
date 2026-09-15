-- Encrypt RouterOS passwords: add ciphertext column, keep plaintext for lazy migration
ALTER TABLE "NetworkDevice" ADD COLUMN IF NOT EXISTS "routerosPasswordEnc" TEXT;
