import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const MODULES = ['Dashboard', 'User Control', 'Customer', 'Package', 'Billing', 'Payments', 'Network', 'Support', 'NOC', 'Notifications', 'Audit Logs', 'Owner'];

function perm(view?: boolean, create?: boolean, edit?: boolean, del?: boolean) {
  return { canView: view ?? false, canCreate: create ?? false, canEdit: edit ?? false, canDelete: del ?? false };
}

const ROLE_PERMISSIONS: Record<string, Record<string, ReturnType<typeof perm>>> = {
  SUPER_ADMIN: Object.fromEntries(MODULES.map(m => [m, perm(true, true, true, true)])),
  CEO: Object.fromEntries(MODULES.map(m => [m, perm(true, false, false, false)])),
  OPERATIONS_MANAGER: Object.fromEntries(
    MODULES.map(m => [
      m,
      {
        Dashboard: perm(true),
        'User Control': perm(true, true, true),
        Customer: perm(true, false, true),
        Package: perm(true, true, true, true),
        Billing: perm(true, false, true),
        Payments: perm(true, false, true),
        Network: perm(true, false, true),
        Support: perm(true, false, false),
        NOC: perm(true, false, true),
        Notifications: perm(true),
      }[m] ?? perm(true),
    ]),
  ),
  BILLING_OFFICER: Object.fromEntries(
    MODULES.map(m => [
      m,
      {
        Dashboard: perm(true),
        Billing: perm(true, true, true),
        Payments: perm(true, false, true),
        Notifications: perm(true),
      }[m] ?? perm(),
    ]),
  ),
  SALES_AGENT: Object.fromEntries(
    MODULES.map(m => [
      m,
      {
        Dashboard: perm(true),
        Customer: perm(true, true, true),
        Package: perm(true, true, true),
        Billing: perm(true),
        Notifications: perm(true),
      }[m] ?? perm(),
    ]),
  ),
  CUSTOMER_SUPPORT: Object.fromEntries(
    MODULES.map(m => [
      m,
      {
        Dashboard: perm(true),
        Customer: perm(true, true, true),
        Package: perm(true),
        Billing: perm(true),
        Payments: perm(true),
        Support: perm(true, true, true),
        Notifications: perm(true),
      }[m] ?? perm(),
    ]),
  ),
  SUPPORT_AGENT: Object.fromEntries(
    MODULES.map(m => [
      m,
      {
        Dashboard: perm(true),
        Customer: perm(true, false, false),
        Package: perm(true),
        Billing: perm(true),
        Payments: perm(true),
        Support: perm(true, true, true),
        Notifications: perm(true),
      }[m] ?? perm(),
    ]),
  ),
  NOC_ENGINEER: Object.fromEntries(
    MODULES.map(m => [
      m,
      {
        Dashboard: perm(true),
        Network: perm(true, true, true),
        NOC: perm(true, false, true),
        Support: perm(true, false, true),
        Notifications: perm(true),
      }[m] ?? perm(),
    ]),
  ),
  FIELD_ENGINEER: Object.fromEntries(
    MODULES.map(m => [
      m,
      {
        Dashboard: perm(true),
        Network: perm(true),
        NOC: perm(true),
        Notifications: perm(true),
      }[m] ?? perm(),
    ]),
  ),
  FINANCE_MANAGER: Object.fromEntries(
    MODULES.map(m => [
      m,
      {
        Dashboard: perm(true),
        Billing: perm(true),
        Payments: perm(true),
        Notifications: perm(true),
      }[m] ?? perm(),
    ]),
  ),
  CUSTOMER: Object.fromEntries(
    MODULES.map(m => [
      m,
      {
        Dashboard: perm(true),
      }[m] ?? perm(),
    ]),
  ),
};

async function createCustomRole(tenantId: string, name: string) {
  const perms = ROLE_PERMISSIONS[name];
  if (!perms) throw new Error(`Unknown role: ${name}`);

  const data: any[] = [];
  for (const [module, p] of Object.entries(perms)) {
    data.push({ module, ...p });
  }

  return prisma.customRole.upsert({
    where: { name },
    update: {
      permissions: {
        deleteMany: {},
        create: data,
      },
    },
    create: {
      tenantId,
      name,
      permissions: { create: data },
    },
  });
}

const PLANS = [
  { id: 'silver-fiber', name: 'SILVER', type: 'FIBER' as const, technology: 'FIBER', category: 'HOME', speedMbps: 10, priceKobo: 1600000, installationFeeKobo: 5000000, description: 'Fiber 10Mbps', features: '["Unlimited Data","Dynamic IP","Email Support"]' },
  { id: 'gold-fiber', name: 'GOLD', type: 'FIBER' as const, technology: 'FIBER', category: 'HOME', speedMbps: 20, priceKobo: 1950000, installationFeeKobo: 5000000, description: 'Fiber 20Mbps', features: '["Unlimited Data","Dynamic IP","Email Support"]' },
  { id: 'platinum-fiber', name: 'PLATINUM', type: 'FIBER' as const, technology: 'FIBER', category: 'HOME', speedMbps: 50, priceKobo: 3450000, installationFeeKobo: 5000000, description: 'Fiber 50Mbps', features: '["Unlimited Data","Dynamic IP","Email Support"]' },
  { id: 'silver-radio', name: 'SILVER', type: 'RADIO' as const, technology: 'RADIO', category: 'HOME', speedMbps: 5, priceKobo: 1600000, installationFeeKobo: 12000000, description: 'Radio 5Mbps', features: '["Unlimited Data","Dynamic IP","Email Support"]' },
  { id: 'gold-radio', name: 'GOLD', type: 'RADIO' as const, technology: 'RADIO', category: 'HOME', speedMbps: 10, priceKobo: 1950000, installationFeeKobo: 12000000, description: 'Radio 10Mbps', features: '["Unlimited Data","Dynamic IP","Email Support"]' },
  { id: 'platinum-radio', name: 'PLATINUM', type: 'RADIO' as const, technology: 'RADIO', category: 'HOME', speedMbps: 15, priceKobo: 3450000, installationFeeKobo: 12000000, description: 'Radio 15Mbps', features: '["Unlimited Data","Dynamic IP","Email Support"]' },
];

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: { name: 'Default Tenant', slug: 'default' },
  });

  const adminHash = await bcrypt.hash('admin123', 12);
  const rootHash = await bcrypt.hash('R8k!mP9xL2#s', 12);

  const roleNames = ['SUPER_ADMIN', 'CEO', 'OPERATIONS_MANAGER', 'NOC_ENGINEER', 'CUSTOMER_SUPPORT', 'SUPPORT_AGENT', 'BILLING_OFFICER', 'SALES_AGENT', 'FIELD_ENGINEER', 'FINANCE_MANAGER', 'CUSTOMER'];
  const customRoles: Record<string, Awaited<ReturnType<typeof createCustomRole>>> = {};
  for (const name of roleNames) {
    customRoles[name] = await createCustomRole(tenant.id, name);
  }

  await prisma.user.upsert({
    where: { email: 'admin@isp.local' },
    update: { isSuperAdmin: false, customRoleId: customRoles['SUPER_ADMIN'].id },
    create: {
      tenantId: tenant.id,
      email: 'admin@isp.local',
      passwordHash: adminHash,
      isSuperAdmin: false,
      customRoleId: customRoles['SUPER_ADMIN'].id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'root@isp.local' },
    update: { isSuperAdmin: true, customRoleId: customRoles['SUPER_ADMIN'].id },
    create: {
      tenantId: tenant.id,
      email: 'root@isp.local',
      passwordHash: rootHash,
      isSuperAdmin: true,
      customRoleId: customRoles['SUPER_ADMIN'].id,
    },
  });

  let created = 0;
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {},
      create: { tenantId: tenant.id, ...plan },
    });
    created++;
  }

  console.log(`Prod bootstrap done: tenant=default, roles=${roleNames.length}, users=2, plans=${created}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());