import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantService } from '../../common/tenant/tenant.service';
import { AuditService } from '../audit-logs/audit.service';
import { MailService, LoginDetailsData } from '../mail/mail.service';

const userSelect = {
  id: true, email: true, name: true, phone: true, isSuperAdmin: true, twoFaEnabled: true, createdAt: true, updatedAt: true,
  customRoleId: true,
  customRole: { select: { id: true, name: true } },
};

export interface ImportRowResult {
  row: number;
  email: string;
  name: string;
  status: string;
  reason?: string;
  plan?: string;
}

export interface ImportJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  stage: string;
  total: number;
  processed: number;
  created: number;
  skipped: number;
  errors: number;
  rows: ImportRowResult[];
  error?: string;
}

export interface LaunchJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  stage: string;
  total: number;
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  skippedList: { email: string; reason: string }[];
  failedList: { email: string; error: string }[];
  error?: string;
}

const planSelect = { id: true, name: true, technology: true, category: true, speedMbps: true, speedLabel: true, priceKobo: true };

const customerInclude: Prisma.SubscriberInclude = {
  user: { select: { id: true, name: true, email: true, phone: true } },
  subscriptions: {
    include: { plan: { select: planSelect } },
    orderBy: { startedAt: 'desc' },
    take: 1,
  },
  invoices: {
    where: { status: { in: ['ISSUED', 'OVERDUE'] } },
    orderBy: { dueAt: 'asc' },
    take: 1,
  },
  devices: true,
};

function toCustomerView(sub: any) {
  const plan = sub.subscriptions?.[0]?.plan ?? null;
  const due = sub.invoices?.[0] ?? null;
  const email: string | null = sub.user?.email ?? null;
  const address: string | null = sub.address ?? null;
  return {
    id: sub.id,
    userId: sub.userId,
    name: sub.user?.name ?? null,
    email: email && !email.endsWith('@lan') ? email : null,
    phone: sub.user?.phone ?? null,
    pppoeUsername: sub.pppoeUsername ?? null,
    address: address && !address.startsWith('Static IP:') ? address : null,
    status: sub.status,
    type: sub.type,
    networkType: sub.networkType ?? plan?.technology ?? null,
    plan: plan?.name ?? null,
    planCategory: plan?.category ?? null,
    speedMbps: plan?.speedMbps ?? null,
    speedLabel: plan?.speedLabel ?? null,
    priceKobo: plan?.priceKobo ?? null,
    startedAt: sub.subscriptions?.[0]?.startedAt ?? null,
    expiresAt: sub.subscriptions?.[0]?.expiresAt ?? null,
    dueAt: due?.dueAt ?? null,
    dueAmountKobo: due?.amountKobo ?? null,
    dueStatus: due?.status ?? null,
    cpes: (sub.devices ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      ipAddress: c.ipAddress,
      macAddress: c.macAddress,
      status: c.status,
      connectionType: c.connectionType,
      installerName: c.installerName,
      lastSeenAt: c.lastSeenAt,
    })),
    createdAt: sub.createdAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async findAll() {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      select: userSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id, deletedAt: null },
      select: userSelect,
    });
  }

  async create(data: { email: string; password: string; phone?: string; name?: string; customRoleId?: string }, actorId: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ConflictException('A user with this email already exists');
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(data.password, 12);
    const tenantId = await this.tenant.resolveTenant();
    const result = await this.prisma.user.create({
      data: { tenantId, email: data.email, name: data.name, passwordHash, phone: data.phone, customRoleId: data.customRoleId },
      select: userSelect,
    });
    await this.audit.log({ actorId, action: 'USER_CREATED', entityType: 'User', entityId: result.id, afterData: { email: data.email, name: data.name, phone: data.phone, customRoleId: data.customRoleId } as any, metadata: { email: data.email, customRoleId: data.customRoleId } });
    return result;
  }

  async update(id: string, data: { email?: string; name?: string; phone?: string; customRoleId?: string; password?: string; isSuperAdmin?: boolean }, actorId: string) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true, name: true, phone: true, isSuperAdmin: true, customRoleId: true } });
    const updateData: any = { ...data };
    if (data.password) {
      const bcrypt = await import('bcryptjs');
      updateData.passwordHash = await bcrypt.hash(data.password, 12);
    }
    delete updateData.password;
    const result = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: userSelect,
    });
    await this.audit.log({ actorId, action: 'USER_UPDATED', entityType: 'User', entityId: id, beforeData: before as any, afterData: { email: result.email, name: result.name, phone: result.phone, isSuperAdmin: result.isSuperAdmin, customRoleId: result.customRoleId } as any, metadata: { changes: Object.keys(data) } });
    return result;
  }

  async customers() {
    const tenantId = await this.tenant.resolveTenant();
    const subs = await this.prisma.subscriber.findMany({
      where: { tenantId, deletedAt: null },
      include: customerInclude,
      orderBy: { createdAt: 'desc' },
    });
    return subs.map(toCustomerView);
  }

  private genPassword(): string {
    return 'Hk-' + crypto.randomBytes(5).toString('hex');
  }

  private readonly launchJobs = new Map<string, LaunchJob>();

  async launchLogins(body: { testEmail?: string }, actorId: string) {
    const tenantId = await this.tenant.resolveTenant();
    const users = await this.prisma.user.findMany({
      where: { tenantId, deletedAt: null, subscriber: { isNot: null } },
      include: {
        subscriber: {
          include: {
            subscriptions: { include: { plan: { select: planSelect } }, orderBy: { startedAt: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const portalUrl = this.config.get<string>('CUSTOMER_URL', 'http://localhost:3001');

    const buildData = (u: any): LoginDetailsData => {
      const sub = u.subscriber;
      const plan = sub?.subscriptions?.[0]?.plan;
      return {
        email: u.email,
        username: sub?.pppoeUsername ?? null,
        password: this.genPassword(),
        customerId: sub?.id.slice(0, 8).toUpperCase() ?? u.id.slice(0, 8).toUpperCase(),
        planName: plan?.name ?? undefined,
        portalUrl,
      };
    };

    if (body.testEmail) {
      const sample = users[0];
      if (!sample) throw new NotFoundException('No customers found');
      const data = buildData(sample);
      await this.mail.sendLoginDetails({ ...data, email: body.testEmail });
      return { mode: 'test', sentTo: body.testEmail, sample: { email: sample.email, username: data.username, customerId: data.customerId, planName: data.planName }, note: 'No passwords were changed (dry run)' };
    }

    const jobId = crypto.randomUUID();
    const job: LaunchJob = {
      id: jobId, status: 'running', stage: 'starting', total: users.length,
      processed: 0, sent: 0, skipped: 0, failed: 0, skippedList: [], failedList: [],
    };
    this.launchJobs.set(jobId, job);
    this.runLaunchJob(users, job, actorId).catch((e: Error) => {
      job.status = 'failed';
      job.error = e?.message?.slice(0, 300) ?? 'Launch failed';
    });
    return { jobId, status: 'running', total: users.length };
  }

  launchStatus(jobId: string): LaunchJob {
    const job = this.launchJobs.get(jobId);
    if (!job) throw new NotFoundException('Launch job not found');
    return job;
  }

  private async runLaunchJob(users: any[], job: LaunchJob, actorId: string) {
    const bcrypt = await import('bcryptjs');
    const skipped: { email: string; reason: string }[] = [];
    const failed: { email: string; error: string }[] = [];

    const batches: any[][] = [];
    for (let i = 0; i < users.length; i += 10) batches.push(users.slice(i, i + 10));

    for (const batch of batches) {
      await Promise.all(batch.map(async (u) => {
        if (!u.email || u.email.endsWith('@local')) {
          skipped.push({ email: u.email ?? '—', reason: 'no real email address' });
          return;
        }
        try {
          const data = {
            email: u.email,
            username: u.subscriber?.pppoeUsername ?? null,
            password: this.genPassword(),
            customerId: u.subscriber?.id.slice(0, 8).toUpperCase() ?? u.id.slice(0, 8).toUpperCase(),
            planName: u.subscriber?.subscriptions?.[0]?.plan?.name ?? undefined,
            portalUrl: this.config.get<string>('CUSTOMER_URL', 'http://localhost:3001'),
          };
          const passwordHash = await bcrypt.hash(data.password, 12);
          await this.prisma.user.update({ where: { id: u.id }, data: { passwordHash } });
          await this.mail.sendLoginDetails(data);
          job.sent++;
        } catch (e: any) {
          failed.push({ email: u.email, error: e?.message ?? 'unknown' });
          job.failed++;
        }
        job.processed++;
      }));
      job.stage = `processing ${Math.min(job.processed, users.length)} of ${users.length}`;
    }

    job.skipped = skipped.length;
    job.skippedList = skipped.slice(0, 20);
    job.failedList = failed.slice(0, 20);

    await this.audit.log({
      actorId,
      action: 'LAUNCH_CUSTOMER_LOGINS',
      entityType: 'User',
      entityId: 'bulk',
      metadata: { sent: job.sent, skipped: skipped.length, failed: failed.length },
    });

    job.status = 'done';
  }

  async customerDetail(id: string) {
    const sub = await this.prisma.subscriber.findUniqueOrThrow({
      where: { id, deletedAt: null },
      include: customerInclude,
    });
    return toCustomerView(sub);
  }

  async updateCustomer(id: string, data: { name?: string; email?: string; phone?: string; address?: string; installerName?: string; networkType?: string; planName?: string; dueAt?: string }, actorId: string) {
    const sub = await this.prisma.subscriber.findUniqueOrThrow({ where: { id, deletedAt: null }, include: { user: true } });
    if (data.email !== undefined || data.phone !== undefined || data.name !== undefined) {
      await this.prisma.user.update({
        where: { id: sub.userId },
        data: {
          ...(data.name !== undefined ? { name: data.name || null } : {}),
          ...(data.email !== undefined ? { email: data.email } : {}),
          ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
        },
      });
    }
    if (data.address !== undefined || data.networkType !== undefined) {
      await this.prisma.subscriber.update({
        where: { id },
        data: {
          ...(data.address !== undefined ? { address: data.address || null } : {}),
          ...(data.networkType !== undefined ? { networkType: data.networkType || null } : {}),
        },
      });
    }
    if (data.installerName !== undefined) {
      await this.prisma.cpe.updateMany({ where: { subscriberId: id }, data: { installerName: data.installerName || null } });
    }
    if (data.planName !== undefined && data.planName) {
      const plan = await this.prisma.plan.findFirst({ where: { tenantId: sub.tenantId, name: { equals: data.planName, mode: 'insensitive' } } });
      if (!plan) throw new NotFoundException(`Plan "${data.planName}" not found`);
      const latest = await this.prisma.subscription.findFirst({ where: { subscriberId: id }, orderBy: { startedAt: 'desc' } });
      if (latest) {
        await this.prisma.subscription.update({ where: { id: latest.id }, data: { planId: plan.id } });
      } else {
        await this.prisma.subscription.create({
          data: { subscriberId: id, planId: plan.id, startedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
        });
      }
    }
    if (data.dueAt !== undefined) {
      const due = new Date(data.dueAt);
      if (isNaN(due.getTime())) throw new BadRequestException('Invalid dueAt date');
      const unpaid = await this.prisma.invoice.findFirst({
        where: { subscriberId: id, status: { in: ['DRAFT', 'ISSUED', 'OVERDUE'] } },
        orderBy: { dueAt: 'asc' },
      });
      if (unpaid) {
        await this.prisma.invoice.update({ where: { id: unpaid.id }, data: { dueAt: due } });
      } else {
        const subWithPlan = await this.prisma.subscription.findFirst({ where: { subscriberId: id }, include: { plan: true }, orderBy: { startedAt: 'desc' } });
        if (subWithPlan) {
          const subtotal = subWithPlan.plan.priceKobo;
          const vat = Math.round(subtotal * 0.075);
          await this.prisma.invoice.create({
            data: {
              subscriberId: id,
              invoiceNumber: `INV-${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`,
              type: 'SUBSCRIPTION',
              status: 'ISSUED',
              subtotalKobo: subtotal,
              vatKobo: vat,
              amountKobo: subtotal + vat,
              dueAt: due,
              issuedAt: new Date(),
            },
          });
        }
      }
    }
    await this.audit.log({ actorId, action: 'USER_UPDATED', entityType: 'User', entityId: sub.userId, beforeData: { name: sub.user.name, email: sub.user.email, phone: sub.user.phone } as any, afterData: data as any, metadata: { changes: Object.keys(data) } });
    return this.customerDetail(id);
  }

  async remove(id: string, actorId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true, phone: true, customRoleId: true, isSuperAdmin: true } });
    await this.audit.log({ actorId, action: 'USER_DELETED', entityType: 'User', entityId: id, beforeData: user as any, metadata: { email: user.email } });
    return this.prisma.$transaction(async (tx) => {
      await tx.auditLog.deleteMany({ where: { actorId: id } });
      await tx.refreshToken.deleteMany({ where: { userId: id } });
      return tx.user.delete({ where: { id }, select: userSelect });
    });
  }

  // ── Excel import ────────────────────────────────────────────

  /**
   * Wipes ALL existing customer data (users with a subscriber, subscribers,
   * subscriptions, invoices/payments/receipts, quotations, chat/tickets,
   * plans, refresh tokens) so a re-upload of the list always starts clean.
   * Staff users (no subscriber) are preserved.
   */
  private async clearCustomerData() {
    await this.prisma.$transaction(async (tx) => {
      const subs = await tx.subscriber.findMany({ select: { id: true } });
      const subIds = subs.map((s) => s.id);
      if (!subIds.length) {
        await tx.plan.deleteMany({ where: {} });
        return;
      }
      const sessions = await tx.chatSession.findMany({ where: { subscriberId: { in: subIds } }, select: { id: true } });
      const sessionIds = sessions.map((s) => s.id);
      const tickets = await tx.ticket.findMany({ where: { subscriberId: { in: subIds } }, select: { id: true } });
      const ticketIds = tickets.map((t) => t.id);
      const invoices = await tx.invoice.findMany({ where: { subscriberId: { in: subIds } }, select: { id: true } });
      const invoiceIds = invoices.map((i) => i.id);
      const payments = await tx.payment.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } });
      const paymentIds = payments.map((pm) => pm.id);
      const quotations = await tx.quotation.findMany({ where: { subscriberId: { in: subIds } }, select: { id: true } });
      const quotationIds = quotations.map((q) => q.id);
      const users = await tx.user.findMany({ where: { subscriber: { isNot: null } }, select: { id: true } });
      const userIds = users.map((u) => u.id);

      await tx.chatMessage.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await tx.fileUpload.deleteMany({ where: { OR: [{ sessionId: { in: sessionIds } }, { ticketId: { in: ticketIds } }] } });
      await tx.chatSession.deleteMany({ where: { id: { in: sessionIds } } });
      await tx.ticketComment.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await tx.ticket.deleteMany({ where: { id: { in: ticketIds } } });
      await tx.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await tx.creditNote.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await tx.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await tx.receipt.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });
      await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      await tx.quotationItem.deleteMany({ where: { quotationId: { in: quotationIds } } });
      await tx.quotation.deleteMany({ where: { id: { in: quotationIds } } });
      await tx.walletTransaction.deleteMany({ where: { wallet: { subscriberId: { in: subIds } } } });
      await tx.virtualAccount.deleteMany({ where: { subscriberId: { in: subIds } } });
      await tx.wallet.deleteMany({ where: { subscriberId: { in: subIds } } });
      await tx.notification.deleteMany({ where: { subscriberId: { in: subIds } } });
      await tx.pppoeSession.deleteMany({ where: { subscriberId: { in: subIds } } });
      await tx.contract.deleteMany({ where: { subscriberId: { in: subIds } } });
      await tx.subscription.deleteMany({ where: { subscriberId: { in: subIds } } });
      await tx.cpe.deleteMany({ where: { subscriberId: { in: subIds } } });
      await tx.subscriber.deleteMany({ where: { id: { in: subIds } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityType: 'User', entityId: { in: userIds } }] } });
      await tx.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await tx.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
      await tx.plan.deleteMany({ where: {} });
    });
  }

  private readonly importJobs = new Map<string, ImportJob>();

  startImport(file: Express.Multer.File, actorId: string): { jobId: string } {
    if (!file) throw new BadRequestException('No file uploaded');
    const jobId = crypto.randomUUID();
    const job: ImportJob = {
      id: jobId, status: 'running', stage: 'reading file', total: 0, processed: 0,
      created: 0, skipped: 0, errors: 0, rows: [],
    };
    this.importJobs.set(jobId, job);
    this.importCustomers(file, actorId, job).catch((e: Error) => {
      job.status = 'failed';
      job.error = e?.message?.slice(0, 300) ?? 'Import failed';
    });
    return { jobId };
  }

  importStatus(jobId: string): ImportJob {
    const job = this.importJobs.get(jobId);
    if (!job) throw new NotFoundException('Import job not found');
    return job;
  }

  async importCustomers(file: Express.Multer.File, actorId: string, job: ImportJob) {
    if (!file) throw new BadRequestException('No file uploaded');
    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new BadRequestException('No sheet found in the file');
    const raw: Array<Record<string, unknown>> = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!raw.length) throw new BadRequestException('No data rows found in the file (first row must be headers)');

    const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const headers = Object.keys(raw[0]);
    const findCol = (keys: string[]): string | null => {
      for (const h of headers) {
        const n = norm(h);
        if (!n) continue;
        if (keys.some(k => n === k || n.startsWith(k + ' ') || n.includes(k))) return h;
      }
      return null;
    };

    const firstNameCol = findCol(['first name', 'firstname', 'first']);
    const lastNameCol = findCol(['last name', 'lastname', 'last', 'surname']);
    const nameCol = firstNameCol && lastNameCol
      ? (findCol(['customer name', 'subscriber name', 'customer', 'subscriber']) ?? headers.find(h => norm(h) === 'name') ?? null)
      : findCol(['name', 'customer', 'subscriber']);
    const companyCol = findCol(['company name', 'company']);
    const emailCol = findCol(['email', 'mail']);
    const phoneCol = findCol(['contact number', 'contact', 'phone', 'mobile', 'telephone']);
    const addressCol = headers.find(h => {
      const n = norm(h);
      return n === 'address' || n === 'location' || n === 'street' || n.startsWith('address ') || n.startsWith('location ') || n.startsWith('street ');
    }) ?? null;
    const stationCol = findCol(['station']);
    const planCol = findCol(['plan', 'package', 'service']);
    const feeCol = findCol(['installation fee', 'fee', 'amount', 'price']);
    const dueCol = findCol(['due date', 'due', 'expiry', 'expires', 'valid until']);
    const portalPassCol = findCol(['portal password']);
    const radiusPassCol = findCol(['password']);
    const userTypeCol = findCol(['user type']);
    const ipAddressCol = findCol(['ip address', 'ip']);
    const idCol = headers.find(h => norm(h) === 'id');
    const id2Col = headers.find(h => norm(h) === 'id2');
    const usernameCol = idCol ?? id2Col;
    if (!emailCol) throw new BadRequestException('Could not find an "email" column in the file');

    const toDate = (v: unknown): Date | null => {
      if (v == null || v === '') return null;
      if (typeof v === 'number') {
        const d = XLSX.SSF.parse_date_code(v);
        if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
        return null;
      }
      const s = String(v).trim();
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };

    const tenantId = await this.tenant.resolveTenant();

    job.stage = 'wiping existing customer data';
    await this.clearCustomerData();

    job.total = raw.length;
    job.stage = 'importing';

    const results: ImportRowResult[] = [];
    let created = 0, skipped = 0, errors = 0;
    const seenUsernames = new Set<string>();

    for (let i = 0; i < raw.length; i++) {
      job.processed = i + 1;
      const r = raw[i];
      const rowNo = i + 2;
      const email = String(r[emailCol] ?? '').trim().toLowerCase().replace(/\s+/g, '');
const name = String(r[nameCol ?? ''] ?? '').trim()
        || [String(r[firstNameCol ?? ''] ?? '').trim(), String(r[lastNameCol ?? ''] ?? '').trim()].filter(Boolean).join(' ')
        || String(r[companyCol ?? ''] ?? '').trim();
      const phone = String(r[phoneCol ?? ''] ?? '').trim();
      const address = String(r[addressCol ?? ''] ?? '').trim() || String(r[stationCol ?? ''] ?? '').trim();
      const planName = planCol ? String(r[planCol] ?? '').trim() : '';
      const fee = feeCol ? parseInt(String(r[feeCol ?? ''] ?? '').replace(/[^0-9]/g, ''), 10) || undefined : undefined;
      const expiresAt = (dueCol && toDate(r[dueCol])) || null;
      const pppoeUsername = usernameCol ? String(r[usernameCol] ?? '').trim() : '';
      const autoEmail = !email && pppoeUsername ? `${pppoeUsername.toLowerCase().replace(/[^a-z0-9._-]/g, '')}@local` : '';
      const useEmail = email || autoEmail;
      const portalPassword = portalPassCol ? String(r[portalPassCol] ?? '').trim() : '';
      const radiusPassword = radiusPassCol ? String(r[radiusPassCol] ?? '').trim() : '';
      const userType = userTypeCol ? String(r[userTypeCol] ?? '').trim().toUpperCase() : '';
      const ipAddress = ipAddressCol ? String(r[ipAddressCol] ?? '').trim() : '';
      const technology = userType.includes('RADIO')
        ? 'RADIO'
        : userType.includes('FIBER')
          ? 'FIBER'
          : userType.includes('WIRELESS')
            ? 'RADIO'
            : '';

      if (!email && !name) { skipped++; results.push({ row: rowNo, email, name, status: 'skipped', reason: 'empty row' }); continue; }
      if (!useEmail) { errors++; results.push({ row: rowNo, email, name, status: 'error', reason: 'missing email & PPPoE username' }); continue; }
      const usernameKey = pppoeUsername.toLowerCase();
      if (pppoeUsername && seenUsernames.has(usernameKey)) {
        skipped++;
        results.push({ row: rowNo, email: useEmail, name, status: 'skipped', reason: `duplicate ID ${pppoeUsername} — already imported` });
        continue;
      }
      seenUsernames.add(usernameKey);

      try {
        const existing = await this.prisma.user.findUnique({ where: { email: useEmail }, select: { id: true } });
        if (existing) {
          skipped++;
          results.push({ row: rowNo, email: useEmail, name, status: 'skipped', reason: 'email already exists' });
          continue;
        }
        let subscriberId = '';
        let radiusNote = '';
        let cpeNote = '';
        if (autoEmail) radiusNote = `email auto-generated from ID (${autoEmail})`;
        await this.prisma.$transaction(async (tx) => {
          const phoneTaken = phone ? await tx.user.findFirst({ where: { phone }, select: { id: true } }) : null;
          const bcrypt = await import('bcryptjs');
          const passwordHash = await bcrypt.hash(portalPassword || crypto.randomBytes(8).toString('hex'), 10);
          const user = await tx.user.create({
            data: { tenantId, email: useEmail, name: name || null, phone: phoneTaken ? null : phone || null, passwordHash },
            select: { id: true },
          });
          const subscriber = await tx.subscriber.create({
            data: {
              tenantId,
              userId: user.id,
              type: 'RESIDENTIAL',
              status: 'ACTIVE',
              address: address || null,
              networkType: technology || null,
              pppoeUsername: pppoeUsername || null,
            },
            select: { id: true },
          });
          subscriberId = subscriber.id;
          if (planName) {
            let plan = await tx.plan.findFirst({ where: { name: { equals: planName, mode: 'insensitive' } }, select: { id: true } });
            if (!plan) {
              plan = await tx.plan.create({
                data: { tenantId, name: planName, type: technology || 'FIBER', technology: technology || 'FIBER', category: 'HOME', speedMbps: 1, priceKobo: fee ?? 0, installationFeeKobo: fee ?? 0, isActive: true },
                select: { id: true },
              });
            }
            await tx.subscription.create({
              data: { subscriberId: subscriber.id, planId: plan.id, autoRenew: true, expiresAt, installationFeeKobo: fee },
            });
          }
          if (ipAddress) {
            const ipTaken = await tx.cpe.findFirst({ where: { ipAddress: { equals: ipAddress, mode: 'insensitive' } }, select: { id: true } });
            if (!ipTaken) {
              await tx.cpe.create({
                data: { subscriberId: subscriber.id, name: pppoeUsername || name || null, ipAddress, macAddress: null, connectionType: 'STATIC_IP' },
              });
            } else {
              cpeNote = `static IP ${ipAddress} already in use — no CPE`;
            }
          }
        });

        // Activate on RADIUS right away for every non-STATIC connection type
        // (FIBER PPPOE, FIBER HOTSPOT, RADIO, ...) — the expiry is written
        // into FreeRADIUS (radcheck Expiration) so it's enforced the moment
        // the session starts.
        const isStatic = userType.includes('STATIC');
        if (pppoeUsername && !isStatic) {
          const serviceToken = process.env.WEBHOOK_SERVICE_TOKEN;
          if (serviceToken) {
            try {
              const r = await fetch(
                `${process.env.RADIUS_SERVICE_URL ?? 'http://localhost:4106'}/api/v1/internal/radius/customers/${subscriberId}/activate`,
                {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'x-webhook-token': serviceToken },
                  body: JSON.stringify({
                    ...(radiusPassword ? { password: radiusPassword } : {}),
                    ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
                  }),
                },
              );
              const body = r.ok ? ((await r.json()) as { expiry?: string }) : null;
              radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}${body?.expiry ? `radius on · expires ${body.expiry}` : r.ok ? 'radius activated' : `radius activation failed (${r.status})`}`;
            } catch {
              radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}radius activation failed`;
            }
          } else {
            radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}radius activation skipped (no service token)`;
          }
        } else if (pppoeUsername && isStatic) {
          radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}static IP user${ipAddress ? ` · ${ipAddress}` : ''} — no RADIUS activation`;
        }
        if (ipAddress && !isStatic) radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}static IP ${ipAddress}`;
        if (cpeNote) radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}${cpeNote}`;
        created++;
        results.push({ row: rowNo, email: useEmail, name, status: 'created', plan: planName || undefined, reason: radiusNote || undefined });
      } catch (e: any) {
        errors++;
        let reason = e?.message?.slice(0, 120) ?? 'unknown error';
        if (e?.code === 'P2002') {
          const target = String(e?.meta?.target ?? '');
          reason = target.includes('email')
            ? 'email already exists'
            : target.includes('pppoeUsername')
              ? 'PPPoE username already taken'
              : 'duplicate value (unique constraint)';
        } else if (e?.code === 'P2003') {
          reason = 'references a missing record (invalid plan or parent)';
        }
        results.push({ row: rowNo, email, name, status: 'error', reason });
      }
      job.created = created;
      job.skipped = skipped;
      job.errors = errors;
      job.rows = results;
    }

    await this.audit.log({
      actorId,
      action: 'CUSTOMERS_IMPORTED',
      entityType: 'User',
      entityId: 'bulk-import',
      metadata: { imported: created, skipped, errors, total: raw.length },
    });
    job.status = 'done';
    job.stage = 'done';
    job.created = created;
    job.skipped = skipped;
    job.errors = errors;
    job.rows = results;
  }
}
