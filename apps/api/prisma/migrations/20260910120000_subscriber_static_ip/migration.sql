-- Per-subscriber static IP (Framed-IP-Address) for fiber clients.
-- Uniqueness is enforced at the database level so a duplicate static IP can
-- never be applied to two PPPoE users (silently breaks sessions on MikroTik).
ALTER TABLE "Subscriber" ADD COLUMN "staticIpAddress" TEXT;
ALTER TABLE "Subscriber" ADD COLUMN "staticIpNetmask" TEXT;
CREATE UNIQUE INDEX "Subscriber_staticIpAddress_key" ON "Subscriber"("staticIpAddress");
