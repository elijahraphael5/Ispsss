-- Align with 16-column import sheet FULL COMPILATION ONBOARDING NEW LIST.xlsx
-- Adds remaining PHPRadius columns that were in schema.prisma but not yet migrated:
-- COMPANY NAME, ID2, FIRST NAME, LAST NAME (Subscriber)
ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "companyName" TEXT;
ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "id2" TEXT;
ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "lastName" TEXT;

-- Helpful indexes for filtering/display (mirrors toCustomerView queries)
CREATE INDEX IF NOT EXISTS "Subscriber_companyName_idx" ON "Subscriber"("companyName");
CREATE INDEX IF NOT EXISTS "Subscriber_firstName_idx" ON "Subscriber"("firstName");
