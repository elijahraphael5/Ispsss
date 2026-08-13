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

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[rand(0, arr.length - 1)];
}

function seqId(prefix: string, year: number, seq: number) {
  return `${prefix}-${year}-${String(seq).padStart(6, '0')}`;
}

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

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: { name: 'Default Tenant', slug: 'default' },
  });

  const adminHash = await bcrypt.hash('admin123', 12);
  const rootHash = await bcrypt.hash('R8k!mP9xL2#s', 12);
  const demoHash = adminHash;

  // ── Custom Roles ─────────────────────────────────────────
  const roleNames = ['SUPER_ADMIN', 'CEO', 'OPERATIONS_MANAGER', 'NOC_ENGINEER', 'CUSTOMER_SUPPORT', 'SUPPORT_AGENT', 'BILLING_OFFICER', 'SALES_AGENT', 'FIELD_ENGINEER', 'FINANCE_MANAGER', 'CUSTOMER'];
  const customRoles: Record<string, Awaited<ReturnType<typeof createCustomRole>>> = {};
  for (const name of roleNames) {
    customRoles[name] = await createCustomRole(tenant.id, name);
  }

  // ── Tenant Admin ─────────────────────────────────────────
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

  // ── Super Admin ──────────────────────────────────────────
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

  const plans = [
    { name: 'Personal Lite', type: 'RADIO' as const, technology: 'RADIO', category: 'PERSONAL', speedMbps: 10, targetUsers: 3, priceKobo: 500000, installationFeeKobo: 50000, routerIncluded: false, description: 'Browsing, Email', features: '["Unlimited Data","Dynamic IP","Email Support","Fair Usage Policy"]' },
    { name: 'Personal Basic', type: 'RADIO' as const, technology: 'RADIO', category: 'PERSONAL', speedMbps: 20, targetUsers: 5, priceKobo: 800000, installationFeeKobo: 50000, routerIncluded: false, description: 'Streaming, Remote Work', features: '["Unlimited Data","Dynamic IP","Email Support","Fair Usage Policy"]' },
    { name: 'Personal Plus', type: 'RADIO' as const, technology: 'RADIO', category: 'PERSONAL', speedMbps: 30, targetUsers: 5, priceKobo: 1200000, installationFeeKobo: 50000, routerIncluded: false, description: 'HD Streaming', features: '["Unlimited Data","Dynamic IP","Email Support","Fair Usage Policy"]' },
    { name: 'Personal Max', type: 'RADIO' as const, technology: 'RADIO', category: 'PERSONAL', speedMbps: 50, targetUsers: 8, priceKobo: 1800000, installationFeeKobo: 50000, routerIncluded: false, description: 'Gaming, Multiple Devices', features: '["Unlimited Data","Dynamic IP","Email Support","Fair Usage Policy"]' },
    { name: 'Home Bronze', type: 'RADIO' as const, technology: 'RADIO', category: 'HOME', speedMbps: 30, targetUsers: 10, priceKobo: 2000000, installationFeeKobo: 75000, routerIncluded: true, description: 'Family Use', features: '["Unlimited Data","Dynamic IP","Free Router","Basic Support","Streaming Optimized"]' },
    { name: 'Home Silver', type: 'RADIO' as const, technology: 'RADIO', category: 'HOME', speedMbps: 50, targetUsers: 15, priceKobo: 3000000, installationFeeKobo: 75000, routerIncluded: true, description: 'Smart Homes', features: '["Unlimited Data","Dynamic IP","Free Router","Basic Support","Streaming Optimized"]' },
    { name: 'Home Gold', type: 'RADIO' as const, technology: 'RADIO', category: 'HOME', speedMbps: 75, targetUsers: 20, priceKobo: 4500000, installationFeeKobo: 75000, routerIncluded: true, description: 'Heavy Streaming', features: '["Unlimited Data","Dynamic IP","Free Router","Basic Support","Streaming Optimized"]' },
    { name: 'Home Platinum', type: 'RADIO' as const, technology: 'RADIO', category: 'HOME', speedMbps: 100, targetUsers: 30, priceKobo: 6000000, installationFeeKobo: 100000, routerIncluded: true, description: 'Large Families', features: '["Unlimited Data","Dynamic IP","Free Router","Basic Support","Streaming Optimized"]' },
    { name: 'Home Diamond', type: 'FIBER' as const, technology: 'FIBER', category: 'HOME', speedMbps: 150, targetUsers: 40, priceKobo: 8000000, installationFeeKobo: 150000, routerIncluded: true, description: 'Luxury Homes', features: '["Unlimited Data","Dynamic IP","Free Router","Basic Support","Streaming Optimized"]' },
    { name: 'Home Elite', type: 'FIBER' as const, technology: 'FIBER', category: 'HOME', speedMbps: 200, targetUsers: 50, priceKobo: 10000000, installationFeeKobo: 150000, routerIncluded: true, description: 'Villas & Estates', features: '["Unlimited Data","Dynamic IP","Free Router","Basic Support","Streaming Optimized"]' },
    { name: 'SME Start', type: 'RADIO' as const, technology: 'RADIO', category: 'SME', speedMbps: 30, targetUsers: 20, priceKobo: 3500000, installationFeeKobo: 100000, routerIncluded: false, description: 'Small Shops', features: '["Unlimited Data","Static IP Optional","Priority Support","Basic SLA","Traffic Monitoring"]' },
    { name: 'SME Basic', type: 'RADIO' as const, technology: 'RADIO', category: 'SME', speedMbps: 50, targetUsers: 40, priceKobo: 5000000, installationFeeKobo: 100000, routerIncluded: false, description: 'Retail Stores', features: '["Unlimited Data","Static IP Optional","Priority Support","Basic SLA","Traffic Monitoring"]' },
    { name: 'SME Business', type: 'RADIO' as const, technology: 'RADIO', category: 'SME', speedMbps: 75, targetUsers: 60, priceKobo: 7500000, installationFeeKobo: 150000, routerIncluded: false, description: 'Small Offices', features: '["Unlimited Data","Static IP Optional","Priority Support","Basic SLA","Traffic Monitoring"]' },
    { name: 'SME Professional', type: 'RADIO' as const, technology: 'RADIO', category: 'SME', speedMbps: 100, targetUsers: 100, priceKobo: 10000000, installationFeeKobo: 150000, routerIncluded: false, description: 'Churches', features: '["Unlimited Data","Static IP Optional","Priority Support","Basic SLA","Traffic Monitoring"]' },
    { name: 'SME Enterprise', type: 'ENTERPRISE' as const, technology: 'FIBER', category: 'SME', speedMbps: 150, targetUsers: 150, priceKobo: 15000000, installationFeeKobo: 200000, routerIncluded: false, description: 'Schools', features: '["Unlimited Data","Static IP Optional","Priority Support","Basic SLA","Traffic Monitoring"]' },
    { name: 'SME Elite', type: 'ENTERPRISE' as const, technology: 'FIBER', category: 'SME', speedMbps: 200, targetUsers: 250, priceKobo: 20000000, installationFeeKobo: 200000, routerIncluded: false, description: 'Large Organizations', features: '["Unlimited Data","Static IP Optional","Priority Support","Basic SLA","Traffic Monitoring"]' },
    { name: 'DIA Bronze 10', type: 'ENTERPRISE' as const, technology: 'FIBER', category: 'DIA_BRONZE', speedMbps: 10, targetUsers: null, priceKobo: 5000000, installationFeeKobo: 300000, contentionRatio: '1:1', staticIp: true, sla: 999, routerIncluded: true, description: 'Entry-level dedicated access', features: '["1:1 Contention Ratio","Guaranteed Bandwidth","Public Static IP","99.9% SLA","Business Support","Network Monitoring","Priority Routing","DDoS Protection","Dedicated Account Manager"]' },
    { name: 'DIA Bronze 20', type: 'ENTERPRISE' as const, technology: 'FIBER', category: 'DIA_BRONZE', speedMbps: 20, targetUsers: null, priceKobo: 7000000, installationFeeKobo: 300000, contentionRatio: '1:1', staticIp: true, sla: 999, routerIncluded: true, description: 'Entry-level dedicated access', features: '["1:1 Contention Ratio","Guaranteed Bandwidth","Public Static IP","99.9% SLA","Business Support","Network Monitoring","Priority Routing","DDoS Protection","Dedicated Account Manager"]' },
    { name: 'DIA Bronze 30', type: 'ENTERPRISE' as const, technology: 'FIBER', category: 'DIA_BRONZE', speedMbps: 30, targetUsers: null, priceKobo: 10000000, installationFeeKobo: 300000, contentionRatio: '1:1', staticIp: true, sla: 999, routerIncluded: true, description: 'Entry-level dedicated access', features: '["1:1 Contention Ratio","Guaranteed Bandwidth","Public Static IP","99.9% SLA","Business Support","Network Monitoring","Priority Routing","DDoS Protection","Dedicated Account Manager"]' },
    { name: 'DIA Bronze 50', type: 'ENTERPRISE' as const, technology: 'FIBER', category: 'DIA_BRONZE', speedMbps: 50, targetUsers: null, priceKobo: 15000000, installationFeeKobo: 300000, contentionRatio: '1:1', staticIp: true, sla: 999, routerIncluded: true, description: 'Entry-level dedicated access', features: '["1:1 Contention Ratio","Guaranteed Bandwidth","Public Static IP","99.9% SLA","Business Support","Network Monitoring","Priority Routing","DDoS Protection","Dedicated Account Manager"]' },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { id: plan.name.toLowerCase().replace(/\s+/g, '-') },
      update: {},
      create: { id: plan.name.toLowerCase().replace(/\s+/g, '-'), tenantId: tenant.id, ...plan },
    });
  }

  const allPlans = await prisma.plan.findMany();

  // ── Clean existing demo data for idempotent re-seed ──────
  await prisma.pppoeSession.deleteMany({});
  await prisma.receipt.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.creditNote.deleteMany({});
  await prisma.invoiceLine.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.refund.deleteMany({});
  await prisma.walletTransaction.deleteMany({});
  await prisma.wallet.deleteMany({});
  await prisma.virtualAccount.deleteMany({});
  await prisma.quotationItem.deleteMany({});
  await prisma.quotation.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.cpe.deleteMany({});
  await prisma.ticketComment.deleteMany({});
  await prisma.ticket.deleteMany({});
  await prisma.chatMessage.deleteMany({});
  await prisma.chatSession.deleteMany({});
  await prisma.cannedResponse.deleteMany({});
  await prisma.agentPresence.deleteMany({});
  await prisma.subscriber.deleteMany({});
  await prisma.contract.deleteMany({});
  await prisma.networkDevice.deleteMany({});
  // Delete all non-staff users (orphaned test users + seeded customers)
  const knownEmails = ['admin@isp.local', 'root@isp.local', 'billing@isp.local', 'noc@isp.local', 'ops@isp.local', 'support@isp.local', 'field@isp.local', 'agent1@isp.local', 'agent2@isp.local'];
  const subscriberIds = (await prisma.subscriber.findMany({ select: { userId: true } })).map(s => s.userId);
  const keepIds = (await prisma.user.findMany({ where: { email: { in: knownEmails } }, select: { id: true } })).map(u => u.id);
  await prisma.user.deleteMany({ where: { id: { notIn: keepIds } } });

  // ── Staff Users ───────────────────────────────────────────
  const staffList = [
    { email: 'billing@isp.local', roleName: 'BILLING_OFFICER', name: 'Amara Nwosu' },
    { email: 'noc@isp.local', roleName: 'NOC_ENGINEER', name: 'Emeka Okafor' },
    { email: 'ops@isp.local', roleName: 'OPERATIONS_MANAGER', name: 'Tunde Balogun' },
    { email: 'support@isp.local', roleName: 'CUSTOMER_SUPPORT', name: 'Chioma Adebayo' },
    { email: 'field@isp.local', roleName: 'FIELD_ENGINEER', name: 'Musa Abubakar' },
    { email: 'agent1@isp.local', roleName: 'SUPPORT_AGENT', name: 'Zainab Ibrahim' },
    { email: 'agent2@isp.local', roleName: 'SUPPORT_AGENT', name: 'Bola Adeyemi' },
  ];
  for (const s of staffList) {
    await prisma.user.upsert({
      where: { email: s.email },
      update: { customRoleId: customRoles[s.roleName].id },
      create: {
        tenantId: tenant.id,
        email: s.email,
        passwordHash: demoHash,
        customRoleId: customRoles[s.roleName].id,
      },
    });
  }

  // ── Customer Users + Subscribers ──────────────────────────
  const customers = [
    { name: 'Chisom Okafor', email: 'chisom.okafor@example.com', phone: '+2348012345601' },
    { name: 'Emeka Nwosu', email: 'emeka.nwosu@example.com', phone: '+2348012345602' },
    { name: 'Amara Eze', email: 'amara.eze@example.com', phone: '+2348012345603' },
    { name: 'Tunde Balogun', email: 'tunde.balogun@example.com', phone: '+2348012345604' },
    { name: 'Chioma Okonkwo', email: 'chioma.okonkwo@example.com', phone: '+2348012345605' },
    { name: 'Kwame Adebayo', email: 'kwame.adebayo@example.com', phone: '+2348012345606' },
    { name: 'Ngozi Uche', email: 'ngozi.uche@example.com', phone: '+2348012345607' },
    { name: 'Oluwaseun Ogunlesi', email: 'oluwaseun.ogunlesi@example.com', phone: '+2348012345608' },
    { name: 'Zainab Abubakar', email: 'zainab.abubakar@example.com', phone: '+2348012345609' },
    { name: 'Musa Diallo', email: 'musa.diallo@example.com', phone: '+2348012345610' },
    { name: 'Yetunde Akinlade', email: 'yetunde.akinlade@example.com', phone: '+2348012345611' },
    { name: 'Chidi Ibrahim', email: 'chidi.ibrahim@example.com', phone: '+2348012345612' },
    { name: 'Femi Olawale', email: 'femi.olawale@example.com', phone: '+2348012345613' },
    { name: 'Kelechi Eneh', email: 'kelechi.eneh@example.com', phone: '+2348012345614' },
    { name: 'Simi Adegoke', email: 'simi.adegoke@example.com', phone: '+2348012345615' },
    { name: 'Efe Bello', email: 'efe.bello@example.com', phone: '+2348012345616' },
    { name: 'Halima Chukwu', email: 'halima.chukwu@example.com', phone: '+2348012345617' },
    { name: 'Ikenna Durojaye', email: 'ikenna.durojaye@example.com', phone: '+2348012345618' },
    { name: 'Jumoke Ekwealor', email: 'jumoke.ekwealor@example.com', phone: '+2348012345619' },
    { name: 'Kolawole Fashola', email: 'kolawole.fashola@example.com', phone: '+2348012345620' },
    { name: 'Adaobi Adeyemi', email: 'adaobi.adeyemi@example.com', phone: '+2348012345621' },
    { name: 'Babatunde Okoro', email: 'babatunde.okoro@example.com', phone: '+2348012345622' },
    { name: 'Chinwe Obi', email: 'chinwe.obi@example.com', phone: '+2348012345623' },
    { name: 'Damilare Abiodun', email: 'damilare.abiodun@example.com', phone: '+2348012345624' },
    { name: 'Folake Salami', email: 'folake.salami@example.com', phone: '+2348012345625' },
    { name: 'Godswill Effiong', email: 'godswill.effiong@example.com', phone: '+2348012345626' },
    { name: 'Hassana Mohammed', email: 'hassana.mohammed@example.com', phone: '+2348012345627' },
    { name: 'Ifeanyi Okeke', email: 'ifeanyi.okeke@example.com', phone: '+2348012345628' },
    { name: 'Joy Osinachi', email: 'joy.osinachi@example.com', phone: '+2348012345629' },
    { name: 'Kafayat Lawal', email: 'kafayat.lawal@example.com', phone: '+2348012345630' },
  ];

  const subscriberStatuses = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'SUSPENDED', 'PENDING_KYC', 'ACTIVE'] as const;
  const subscriberTypes = ['RESIDENTIAL', 'RESIDENTIAL', 'BUSINESS', 'RESIDENTIAL', 'BUSINESS', 'ENTERPRISE', 'RESIDENTIAL', 'BUSINESS', 'RESIDENTIAL', 'RESIDENTIAL'] as const;

  const subscribers: any[] = [];
  for (const c of customers) {
    const existing = await prisma.user.findUnique({ where: { email: c.email } });
    if (existing) {
      const sub = await prisma.subscriber.findUnique({ where: { userId: existing.id } });
      if (sub) { subscribers.push(sub); continue; }
      const newSub = await prisma.subscriber.create({
        data: {
          tenantId: tenant.id,
          userId: existing.id,
          type: pick([...subscriberTypes]),
          status: pick([...subscriberStatuses]),
        },
      });
      subscribers.push(newSub);
      continue;
    }
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: c.email,
        name: c.name,
        phone: c.phone,
        passwordHash: demoHash,
        customRoleId: customRoles['CUSTOMER'].id,
      },
    });
    const sub = await prisma.subscriber.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        type: pick([...subscriberTypes]),
        status: pick([...subscriberStatuses]),
      },
    });
    subscribers.push(sub);
  }

  // ── Subscriptions ─────────────────────────────────────────
  const subscriptions: any[] = [];
  for (const sub of subscribers) {
    if (sub.status === 'PENDING_KYC') continue;
    const plan = pick(allPlans);
    const existing = await prisma.subscription.findFirst({ where: { subscriberId: sub.id } });
    if (existing) { subscriptions.push(existing); continue; }
    const startDays = rand(30, 120);
    const subRec = await prisma.subscription.create({
      data: {
        subscriberId: sub.id,
        planId: plan.id,
        startedAt: new Date(Date.now() - startDays * 86400000),
        expiresAt: new Date(Date.now() + rand(5, 25) * 86400000),
      },
    });
    subscriptions.push(subRec);
  }

  // ── Network Devices ───────────────────────────────────────
  const deviceData = [
    { name: 'MikroTik CCR1036', type: 'nas', vendor: 'MikroTik', ipAddress: '10.0.0.1', location: 'Lagos Island DC', status: 'ONLINE', cpu: 45.2, memory: 62.8, sessions: 12, secret: 'mikrotik-secret' },
    { name: 'Cisco ASR1001', type: 'nas', vendor: 'Cisco', ipAddress: '10.0.0.2', location: 'Ikeja PoP', status: 'ONLINE', cpu: 38.7, memory: 55.3, sessions: 8, secret: 'cisco-secret' },
    { name: 'Huawei ME60', type: 'nas', vendor: 'Huawei', ipAddress: '10.0.0.3', location: 'VI DC', status: 'ONLINE', cpu: 52.1, memory: 71.4, sessions: 15, secret: 'huawei-secret' },
    { name: 'Core Router-01', type: 'router', vendor: 'Cisco', ipAddress: '10.0.1.1', location: 'Lagos Island DC', status: 'ONLINE', cpu: 28.9, memory: 44.2 },
    { name: 'Core Router-02', type: 'router', vendor: 'Juniper', ipAddress: '10.0.1.2', location: 'Abuja DC', status: 'WARNING', cpu: 72.3, memory: 81.5 },
    { name: 'Dist Switch-01', type: 'switch', vendor: 'HP', ipAddress: '10.0.2.1', location: 'Ikeja PoP', status: 'ONLINE', cpu: 22.1, memory: 35.6 },
    { name: 'Dist Switch-02', type: 'switch', vendor: 'Cisco', ipAddress: '10.0.2.2', location: 'VI PoP', status: 'OFFLINE', cpu: 0, memory: 0 },
    { name: 'OLT-01', type: 'olt', vendor: 'Huawei', ipAddress: '10.0.3.1', location: 'Lagos Island PoP', status: 'ONLINE', cpu: 33.5, memory: 48.9 },
  ];
  for (const d of deviceData) {
    await prisma.networkDevice.upsert({
      where: { ipAddress: d.ipAddress },
      update: {},
      create: { tenantId: tenant.id, ...d },
    });
  }



  // ── Invoices (3 months history) ──────────────────────────
  const activeSubs = subscribers.filter(s => s.status !== 'PENDING_KYC');
  const year = 2026;
  let invCounters = { SUBSCRIPTION: 0, INSTALLATION: 0, ONE_TIME: 0, MANUAL: 0 };
  const invPrefixes: Record<string, string> = { SUBSCRIPTION: 'INV', INSTALLATION: 'INV-INS', ONE_TIME: 'INV-OTS', MANUAL: 'INV-MAN' };

  const allInvoices: any[] = [];
  const now = Date.now();
  for (const sub of activeSubs) {
    const monthsBack = rand(1, 3);
    for (let m = monthsBack; m >= 0; m--) {
      const invDate = new Date(now - m * 30 * 86400000);
      const plan = pick(allPlans);
      const invType = m === monthsBack ? 'INSTALLATION' : 'SUBSCRIPTION';
      const baseKobo = m === monthsBack ? plan.installationFeeKobo : plan.priceKobo;
      if (baseKobo === 0) continue;
      invCounters[invType]++;
      const vatKobo = Math.round(baseKobo * 0.075);
      const dueAt = new Date(invDate.getTime() + 14 * 86400000);

      let status: string;
      if (m >= 2) { status = pick(['PAID', 'PAID', 'PAID', 'PAID', 'VOID']); }
      else if (m === 1) { status = pick(['PAID', 'PAID', 'PAID', 'ISSUED', 'OVERDUE']); }
      else { status = pick(['ISSUED', 'ISSUED', 'PAID', 'DRAFT', 'OVERDUE']); }

      const paidAt = status === 'PAID' ? new Date(invDate.getTime() + rand(1, 5) * 86400000) : null;

      const inv = await prisma.invoice.create({
        data: {
          invoiceNumber: seqId(invPrefixes[invType], year, invCounters[invType]),
          subscriberId: sub.id,
          type: invType as any,
          status: status as any,
          amountKobo: baseKobo + vatKobo,
          subtotalKobo: baseKobo,
          vatKobo,
          discountKobo: 0,
          dueAt,
          issuedAt: status !== 'DRAFT' ? new Date(invDate.getTime() + 86400000) : null,
          paidAt,
          lines: {
            create: {
              description: m === monthsBack ? `${plan.name} — Installation` : `${plan.name} — ${plan.speedMbps}Mbps (Monthly)`,
              amountKobo: baseKobo,
              quantity: 1,
            },
          },
        },
      });
      allInvoices.push(inv);
    }
  }

  // ── Payments + Receipts ──────────────────────────────────
  const paidInvoices = allInvoices.filter(i => i.status === 'PAID');
  let recCounter = 0;
  for (const inv of paidInvoices) {
    recCounter++;
    const providers = ['PAYSTACK', 'BANK_TRANSFER', 'FLUTTERWAVE', 'PAYSTACK', 'PAYSTACK'] as const;
    const provider = pick([...providers]);
    const ref = `PAY-${year}-${String(rand(100000, 999999))}-${String(rand(1000, 9999))}`;
    const paidAt = inv.paidAt || new Date();

    await prisma.payment.create({
      data: {
        invoiceId: inv.id,
        provider: provider as any,
        status: 'SUCCESSFUL',
        amountKobo: inv.amountKobo,
        reference: ref,
        providerReference: ref + '-prv',
        feesKobo: Math.round(inv.amountKobo * 0.015),
        paidAt,
      },
    });

    await prisma.receipt.create({
      data: {
        receiptNumber: seqId('RCT', year, recCounter),
        invoiceId: inv.id,
        amountKobo: inv.amountKobo,
        paymentMethod: provider,
        transactionRef: ref,
        paidAt,
      },
    });
  }

  // ── Support demo data (canned, presence, chat, tickets) ──
  const supportAgents = await prisma.user.findMany({
    where: { email: { in: ['support@isp.local', 'agent1@isp.local', 'agent2@isp.local'] } },
    select: { id: true, email: true, tenantId: true },
  });
  const agents = supportAgents.map((a) => ({ id: a.id, email: a.email, name: a.email.split('@')[0], tenantId: a.tenantId }));
  const agentByEmail: Record<string, string> = Object.fromEntries(agents.map((a) => [a.email, a.id]));

  function daysAgo(d: number) {
    return new Date(Date.now() - d * 86400000);
  }
  function minutesAgo(m: number) {
    return new Date(Date.now() - m * 60000);
  }

  // Canned responses
  const cannedSeed = [
    { title: 'Welcome to live chat', body: "Hi there! Thanks for reaching out to Hikonnect support. I'll be happy to help — could you give me a quick summary of the issue?", category: 'Greeting' },
    { title: 'Acknowledge Internet down', body: 'I understand your internet is down. Let me check your connection status on our network monitoring dashboard right away. Can you confirm your router status LED?', category: 'Connectivity' },
    { title: 'Scheduled maintenance notice', body: 'We are currently performing scheduled maintenance in your area. Service should be restored within the next 2 hours. We apologise for the inconvenience.', category: 'Network' },
    { title: 'Billing question pathway', body: 'I can help with that billing question. Your latest invoice would have been sent to your registered email. Is this about an invoice amount or a renewal date?', category: 'Billing' },
    { title: 'PPPoE credentials reset', body: 'I can reset your PPPoE login credentials. Your new details will be available here in chat shortly. Please keep them private.', category: 'Support' },
    { title: 'Closing / upsell', body: "Is there anything else I can help you with? If not, I'll close this chat — you can always rate this conversation afterwards. Have a great day!", category: 'Closure' },
  ];
  for (const c of cannedSeed) {
    await prisma.cannedResponse.create({ data: { tenantId: tenant.id, ...c } });
  }

  // Agent presence
  await prisma.agentPresence.create({
    data: { tenantId: tenant.id, userId: agentByEmail['agent1@isp.local'], status: 'ONLINE', lastSeenAt: minutesAgo(2) },
  });
  await prisma.agentPresence.create({
    data: { tenantId: tenant.id, userId: agentByEmail['agent2@isp.local'], status: 'ONLINE', lastSeenAt: minutesAgo(5) },
  });
  await prisma.agentPresence.create({
    data: { tenantId: tenant.id, userId: agentByEmail['support@isp.local'], status: 'OFFLINE', lastSeenAt: minutesAgo(3600) },
  });

  // Chat sessions — pick active subscribers with context
  const chatCandidates = subscribers
    .map((s, i) => ({ ...s, name: customers[i].name, email: customers[i].email }))
    .filter((s) => s.status !== 'PENDING_KYC');

  interface ChatLine { senderType: string; body: string; }
  const chatScripts: Array<{
    kind: 'waiting' | 'active' | 'closed';
    customerIdx: number;
    agentIdx?: number;
    agoMin: number;
    closeMinAgo?: number;
    csat?: number;
    convo: ChatLine[];
  }> = [
    {
      kind: 'waiting', customerIdx: 0, agoMin: 12,
      convo: [
        { senderType: 'CUSTOMER', body: 'Hello! My internet keeps dropping every few minutes today. Can anyone look into it?' },
        { senderType: 'CUSTOMER', body: 'I have restarted the router twice already.' },
      ],
    },
    {
      kind: 'waiting', customerIdx: 1, agoMin: 3,
      convo: [{ senderType: 'CUSTOMER', body: 'Hi — I just paid my invoice and my connection is still offline. Reference PAY-2026-482011.' }],
    },
    {
      kind: 'active', customerIdx: 2, agentIdx: 0, agoMin: 35,
      convo: [
        { senderType: 'CUSTOMER', body: 'Good morning. My speed has been very slow since yesterday evening.' },
        { senderType: 'AGENT', body: 'Good morning! Let me check your plan and current usage. One moment please.' },
        { senderType: 'CUSTOMER', body: 'Okay, thank you. It is very bad right now.' },
        { senderType: 'AGENT', body: 'I can see you are on the Personal Plus plan. There is high load on your tower; we are optimising the backhaul now. You should see improvement within 30 minutes.' },
        { senderType: 'CUSTOMER', body: 'Great, thanks for the update. I will wait.' },
      ],
    },
    {
      kind: 'active', customerIdx: 3, agentIdx: 1, agoMin: 18,
      convo: [
        { senderType: 'CUSTOMER', body: 'I want to change my plan from Home Bronze to Home Silver. Is there an extra fee?' },
        { senderType: 'AGENT', body: 'Yes — the difference will be billed to your next invoice. I can put the change through now. Would you like to proceed?' },
        { senderType: 'CUSTOMER', body: 'Okay please go ahead.' },
      ],
    },
    {
      kind: 'closed', customerIdx: 4, agentIdx: 0, agoMin: 26 * 60, closeMinAgo: 20 * 60, csat: 5,
      convo: [
        { senderType: 'CUSTOMER', body: 'My PPPoE password was changed and I cannot reconnect anymore.' },
        { senderType: 'AGENT', body: 'No problem — I will issue you fresh credentials. Please note them down: username stays the same, password is HnkT2#!54o.' },
        { senderType: 'CUSTOMER', body: 'It works now. Thank you!' },
        { senderType: 'AGENT', body: 'You are welcome! Anything else today?' },
        { senderType: 'CUSTOMER', body: 'That is all. Thank you!' },
      ],
    },
    {
      kind: 'closed', customerIdx: 5, agentIdx: 1, agoMin: 50 * 60, closeMinAgo: 45 * 60, csat: 4,
      convo: [
        { senderType: 'CUSTOMER', body: 'Do you have an office in Abuja? I want to register a business line.' },
        { senderType: 'AGENT', body: 'Yes, we are at Abuja DC. You can also start the SME Business plan online. Would you like me to add the plan for you?' },
        { senderType: 'CUSTOMER', body: "I will come to the office instead. Thanks." },
      ],
    },
    {
      kind: 'closed', customerIdx: 6, agentIdx: 0, agoMin: 120 * 60, closeMinAgo: 110 * 60, csat: 3,
      convo: [
        { senderType: 'CUSTOMER', body: 'My static IP stopped working after the last change. My camera setup is down.' },
        { senderType: 'AGENT', body: 'Let me check your static IP assignment. Can you share the IP you configured on your camera?' },
        { senderType: 'CUSTOMER', body: 'It is 10.10.44.7.' },
        { senderType: 'AGENT', body: 'That IP is not in your assignment range. I have re-provisioned your CPE — please reboot once and it will come up on the correct block.' },
      ],
    },
    {
      kind: 'closed', customerIdx: 7, agentIdx: 1, agoMin: 200 * 60, closeMinAgo: 195 * 60, csat: 5,
      convo: [
        { senderType: 'CUSTOMER', body: 'I need to update my billing address on file.' },
        { senderType: 'AGENT', body: 'Sure — please send the new address and I will update your subscriber record.' },
        { senderType: 'CUSTOMER', body: '12 Fola Adeola Estate, Ikeja Lagos.' },
        { senderType: 'AGENT', body: 'Done! Your next invoice will be sent to the new address. Anything else?' },
        { senderType: 'CUSTOMER', body: 'That is all. Thanks!' },
      ],
    },
  ];

  for (const script of chatScripts) {
    const sub = chatCandidates[script.customerIdx];
    if (!sub) continue;
    const started = minutesAgo(script.agoMin);
    const agentId = script.agentIdx !== undefined ? agents[script.agentIdx].id : null;
    const status = script.kind === 'waiting' ? 'WAITING' : script.kind === 'closed' ? 'CLOSED' : 'ACTIVE';
    const firstAgentMsgAt = (() => {
      const idx = script.convo.findIndex((m) => m.senderType === 'AGENT');
      return idx === -1 ? null : new Date(started.getTime() + idx * 2 * 60000);
    })();

    const session = await prisma.chatSession.create({
      data: {
        tenantId: tenant.id,
        subscriberId: sub.id,
        agentId,
        customerName: sub.name.split(' ')[0] ?? sub.name,
        customerEmail: sub.email,
        status: status as any,
        firstResponseAt: firstAgentMsgAt ?? undefined,
        csat: script.csat ?? undefined,
        closedAt: script.closeMinAgo !== undefined ? minutesAgo(script.closeMinAgo) : undefined,
        createdAt: started,
      },
    });

    let i = 0;
    for (const msg of script.convo) {
      const at = new Date(started.getTime() + i * 2 * 60000);
      await prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          senderId: msg.senderType === 'AGENT' ? agentId : sub.userId,
          senderName: msg.senderType === 'AGENT' ? (agents.find((a) => a.id === agentId)?.name ?? 'Support Agent') : sub.name.split(' ')[0],
          senderType: msg.senderType as any,
          body: msg.body,
          status: 'READ',
          readAt: at,
          createdAt: at,
        },
      });
      i++;
    }
  }

  // Tickets + comments
  const ticketSeeds = [
    { subIdx: 0, subject: 'Repeated connection dropouts — day two', category: 'Connectivity', status: 'OPEN', priority: 'URGENT', agentIdx: 0, daysAgo: 1, comments: [
      { body: 'Customer reports dropouts every 5-10 minutes. Confirmed on our end via ping logs. Sending field team today.', authorType: 'AGENT', email: 'agent1@isp.local', internal: true },
    ] },
    { subIdx: 2, subject: 'Upgrade request: Personal Basic to Personal Plus', category: 'Upgrade', status: 'IN_PROGRESS', priority: 'MEDIUM', agentIdx: 1, daysAgo: 2, comments: [] },
    { subIdx: 5, subject: 'Business line installation quote', category: 'Sales', status: 'OPEN', priority: 'HIGH', agentIdx: null, daysAgo: 3, comments: [
      { body: 'Customer wants SME Start plan at Ikeja office. Installation window requested for Friday.', authorType: 'AGENT', email: 'agent2@isp.local', internal: false },
    ] },
    { subIdx: 8, subject: 'Duplicate invoice charge noticed', category: 'Billing', status: 'RESOLVED', priority: 'HIGH', agentIdx: 0, daysAgo: 4, comments: [
      { body: 'Duplicate charge reversed as credit note.', authorType: 'AGENT', email: 'agent1@isp.local', internal: true },
    ] },
    { subIdx: 3, subject: 'Static IP not responding since power flash', category: 'Connectivity', status: 'CLOSED', priority: 'MEDIUM', agentIdx: 1, daysAgo: 5, comments: [] },
  ];

  for (const t of ticketSeeds) {
    const sub = chatCandidates[t.subIdx];
    const agent = t.agentIdx !== null && t.agentIdx !== undefined ? agents[t.agentIdx].id : null;
    const resolved = t.status === 'RESOLVED' || t.status === 'CLOSED';
    const ticket = await prisma.ticket.create({
      data: {
        tenantId: tenant.id,
        subscriberId: sub.id,
        assignedAgentId: agent,
        subject: t.subject,
        description: null,
        category: t.category,
        priority: t.priority as any,
        status: t.status as any,
        slaDueAt: new Date(Date.now() + rand(10, 220) * 3600000),
        resolvedAt: resolved ? daysAgo(Math.max(0, t.daysAgo - 2)) : null,
        createdAt: daysAgo(t.daysAgo),
        updatedAt: daysAgo(t.daysAgo),
      },
    });
    void ticket;

    let ci = 0;
    for (const c of t.comments) {
      const authorUser = await prisma.user.findFirst({ where: { email: c.email }, select: { id: true } });
      await prisma.ticketComment.create({
        data: {
          ticketId: ticket.id,
          authorId: authorUser?.id ?? null,
          author: c.email,
          authorType: c.authorType as any,
          body: c.body,
          internal: c.internal,
          createdAt: new Date(daysAgo(t.daysAgo).getTime() + (ci + 1) * 3600000),
        },
      });
      ci++;
    }
  }

  const supportTickets = await prisma.ticket.count();
  const totalInvoices = allInvoices.length;
  const totalPayments = paidInvoices.length;
  const totalSessions = (await prisma.pppoeSession.findMany()).length;

  console.log(`Seeded: ${staffList.length} staff, ${customers.length} customers, ${subscribers.length} subscribers, ${deviceData.length} devices, ${totalInvoices} invoices, ${totalPayments} payments, ${totalSessions} PPPoE sessions, ${chatScripts.length} chat sessions, ${supportTickets} tickets`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
