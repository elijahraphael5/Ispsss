#!/usr/bin/env tsx
// One-off data migration: encrypt existing NetworkDevice.routerosPassword plaintext into routerosPasswordEnc
import { PrismaClient } from '@prisma/client';
import { encryptSecret } from '@isp/prisma';

const prisma = new PrismaClient();

async function main() {
  const devices = await prisma.networkDevice.findMany({
    where: {
      routerosPassword: { not: null },
      routerosPasswordEnc: null,
    } as any,
    select: { id: true, routerosPassword: true } as any,
  });
  console.log(`Found ${devices.length} devices with plaintext password to encrypt`);
  let ok = 0;
  let fail = 0;
  for (const d of devices as any[]) {
    try {
      const enc = encryptSecret(d.routerosPassword);
      await prisma.networkDevice.update({
        where: { id: d.id },
        data: { routerosPasswordEnc: enc, routerosPassword: null } as any,
      });
      console.log(`  ✓ ${d.id} encrypted`);
      ok++;
    } catch (e: any) {
      console.error(`  ✗ ${d.id} failed:`, e.message);
      fail++;
    }
  }
  console.log(`Done: ${ok} encrypted, ${fail} failed`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
