import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apps = [
  'api',
  'auth-service',
  'billing-service',
  'customer-service',
  'payments-service',
  'radius-service',
  'support-service',
];

const hashes = apps.map((app) => {
  const p = join(root, 'apps', app, 'prisma', 'schema.prisma');
  if (!existsSync(p)) {
    console.error(`Missing schema: ${p}`);
    process.exit(1);
  }
  return {
    app,
    hash: createHash('sha256').update(readFileSync(p)).digest('hex'),
  };
});

const reference = hashes[0].hash;
const drifted = hashes.filter((h) => h.hash !== reference);
if (drifted.length) {
  console.error('Prisma schema drift detected — every app must carry the identical schema:');
  for (const d of drifted) console.error(`  - apps/${d.app}/prisma/schema.prisma`);
  console.error(`Expected sha256 ${reference}`);
  process.exit(1);
}

console.log(`OK: ${apps.length} Prisma schemas are identical (${reference.slice(0, 12)}…)`);
