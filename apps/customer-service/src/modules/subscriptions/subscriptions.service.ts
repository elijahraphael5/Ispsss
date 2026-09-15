import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { softDelete, softDeleteMany } from '@isp/prisma';
import { AuditService } from '../audit-logs/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService) {}

  async findAll(skip = 0, take = 50, search?: string, planFilter?: string) {
    const where: any = { deletedAt: null };
    if (search) {
      where.OR = [
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { user: { phone: { contains: search } } },
      ];
    }
    if (planFilter && planFilter !== 'ALL') {
      where.subscriptions = { some: { plan: { type: planFilter } } };
    }
    const [data, total] = await Promise.all([
      this.prisma.subscriber.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true, phone: true } }, subscriptions: { include: { plan: true }, take: 1 }, devices: { select: { connectionType: true, ipAddress: true, status: true }, take: 5 } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.subscriber.count({ where }),
    ]);
    return { data, total, skip, take };
  }

  async findOne(id: string) {
    return this.prisma.subscriber.findUniqueOrThrow({
      where: { id },
      include: { user: { select: { id: true, email: true, phone: true } }, subscriptions: { include: { plan: true } } },
    });
  }

  /**
   * `Subscriber.pppoeUsername` is unique across ALL rows — soft-deleted ones
   * included, since the DB index ignores `deletedAt`. A stale row releases the
   * username so a re-created customer can reuse it; a live duplicate gets a
   * 409 instead of the Prisma unique-constraint 500.
   */
  private async assertPppoeAvailable(username: string): Promise<void> {
    const rows: Array<{ id: string; deletedAt: Date | null }> = await this.prisma.$queryRaw`
      SELECT id, "deletedAt" FROM "Subscriber" WHERE "pppoeUsername" = ${username} LIMIT 1
    `;
    const owner = rows[0];
    if (!owner) return;
    if (!owner.deletedAt) throw new ConflictException('PPPoE username is already in use by another customer');
    await this.prisma.$queryRaw`UPDATE "Subscriber" SET "pppoeUsername" = NULL WHERE id = ${owner.id}`;
  }

  async create(data: { userId: string; type: string; address?: string; pppoeUsername?: string; networkType?: string }, actorId?: string) {
    const tenantId = (await this.prisma.tenant?.findFirst())?.id;
    if (data.pppoeUsername) await this.assertPppoeAvailable(data.pppoeUsername);
    // A soft-deleted subscriber (customer deleted earlier) still holds the
    // unique userId slot — restore it instead of crashing on the constraint.
    const rows: Array<{ id: string }> = await this.prisma.$queryRaw`SELECT id FROM "Subscriber" WHERE "userId" = ${data.userId} LIMIT 1`;
    if (rows[0]) {
      const sub = await this.prisma.subscriber.update({
        where: { id: rows[0].id },
        data: {
          type: data.type as any,
          status: 'PENDING_KYC',
          kycVerified: false,
          ...(data.address !== undefined ? { address: data.address || null } : {}),
          ...(data.pppoeUsername !== undefined ? { pppoeUsername: data.pppoeUsername || null } : {}),
          ...(data.networkType !== undefined ? { networkType: data.networkType || null } : {}),
          // Maker–checker KYC: fresh submission by whoever recreates the account.
          kycSubmittedById: actorId ?? null,
          kycSubmittedAt: actorId ? new Date() : undefined,
          kycApprovedById: null,
          kycApprovedAt: null,
          kycRejectedById: null,
          kycRejectedAt: null,
          kycRejectReason: null,
          deletedAt: null,
        },
        include: { user: { select: { id: true, email: true, phone: true } } },
      });
      await this.audit.log({ action: 'SUBSCRIBER_CREATED', entityType: 'Subscriber', entityId: sub.id, metadata: { userId: data.userId, type: data.type, revived: true } });
      await this.notifications.create({ title: 'New Account Created', message: `Customer ${sub.user?.email ?? '—'} signed up`, type: 'INFO', subscriberId: sub.id, link: '/subscriptions/subscribers' });
      return sub;
    }
    let sub;
    try {
      sub = await this.prisma.subscriber.create({
        data: {
          tenantId,
          userId: data.userId,
          type: data.type as any,
          address: data.address,
          pppoeUsername: data.pppoeUsername,
          networkType: data.networkType,
          // Maker–checker KYC: record which admin created the account so the
          // KYC approver (checker) can never be the same person.
          kycSubmittedById: actorId ?? null,
          kycSubmittedAt: actorId ? new Date() : undefined,
        },
        include: { user: { select: { id: true, name: true, email: true, phone: true } } },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('PPPoE username is already in use by another customer');
      throw e;
    }
    await this.audit.log({ action: 'SUBSCRIBER_CREATED', entityType: 'Subscriber', entityId: sub.id, metadata: { userId: data.userId, type: data.type } });
    await this.notifications.create({ title: 'New Account Created', message: `Customer ${sub.user?.email ?? '—'} signed up`, type: 'INFO', subscriberId: sub.id, link: '/subscriptions/subscribers' });
    return sub;
  }

  async update(id: string, data: { type?: string; status?: string }) {
    if (data.status === 'ACTIVE') {
      // KYC gate: an account stuck in PENDING_KYC can only be activated by the
      // maker–checker approval flow, never by a plain status PATCH.
      const cur = await this.prisma.subscriber.findUnique({ where: { id }, select: { status: true, kycVerified: true } });
      if (cur && cur.status === 'PENDING_KYC' && !cur.kycVerified) {
        throw new BadRequestException('Account is pending KYC — approve it from the KYC tab before activating.');
      }
    }
    const sub = await this.prisma.subscriber.update({
      where: { id },
      data: data as any,
      include: { user: { select: { id: true, email: true, phone: true } } },
    });
    await this.audit.log({ action: 'SUBSCRIBER_UPDATED', entityType: 'Subscriber', entityId: id, metadata: data as any });
    return sub;
  }

  async remove(id: string, actor?: { id: string; isSuperAdmin?: boolean; customRole?: { name: string } | null }) {
    if (actor) {
      this.audit.assertNotMaker(actor, await this.audit.makerOf('Subscriber', id), 'customer');
    }
    // Deleting a customer must release their login email for fresh use — the
    // user row survives (audit trail) but its address moves to a placeholder.
    const userRows: Array<{ userId: string }> = await this.prisma.$queryRaw`SELECT "userId" FROM "Subscriber" WHERE id = ${id} LIMIT 1`;
    const userId = userRows[0]?.userId;
    return this.prisma.$transaction(async (tx) => {
      if (userId) {
        await tx.refreshToken.deleteMany({ where: { userId } });
        await tx.user.update({ where: { id: userId }, data: { email: `deleted-${userId}@local` } });
      }
      const invoices = await tx.invoice.findMany({ where: { subscriberId: id }, select: { id: true } });
      const invoiceIds = invoices.map((i) => i.id);
      if (invoiceIds.length > 0) {
        // Financial records are soft-deleted so the full payment ledger + audit trail persist.
        await softDeleteMany(tx.invoiceLine, { where: { invoiceId: { in: invoiceIds } } });
        await softDeleteMany(tx.creditNote, { where: { invoiceId: { in: invoiceIds } } });
        await softDeleteMany(tx.receipt, { where: { invoiceId: { in: invoiceIds } } });

        const payments = await tx.payment.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } });
        const paymentIds = payments.map((p) => p.id);
        if (paymentIds.length > 0) {
          await softDeleteMany(tx.refund, { where: { paymentId: { in: paymentIds } } });
          await softDeleteMany(tx.refund, { where: { invoiceId: { in: invoiceIds } } });
        }

        await softDeleteMany(tx.payment, { where: { invoiceId: { in: invoiceIds } } });
        await softDeleteMany(tx.invoice, { where: { id: { in: invoiceIds } } });
      }

      const wallets = await tx.wallet.findMany({ where: { subscriberId: id }, select: { id: true } });
      const walletIds = wallets.map((w) => w.id);
      if (walletIds.length > 0) {
        await softDeleteMany(tx.walletTransaction, { where: { walletId: { in: walletIds } } });
        await softDeleteMany(tx.wallet, { where: { id: { in: walletIds } } });
      }

      // CPEs are soft-deleted with their unique macAddress released so the
      // hardware can be attached to a new customer later.
      await tx.cpe.updateMany({ where: { subscriberId: id }, data: { deletedAt: new Date(), macAddress: null } });
      await softDeleteMany(tx.subscription, { where: { subscriberId: id } });
      await tx.ticketComment.deleteMany({ where: { ticket: { subscriberId: id } } });
      await softDeleteMany(tx.ticket, { where: { subscriberId: id } });
      await tx.chatMessage.deleteMany({ where: { session: { subscriberId: id } } });
      await softDeleteMany(tx.chatSession, { where: { subscriberId: id } });
      await softDeleteMany(tx.contract, { where: { subscriberId: id } });
      const deleted = await softDelete(tx.subscriber, { where: { id } });
      await this.audit.log({ action: 'SUBSCRIBER_DELETED', entityType: 'Subscriber', entityId: id });
      return deleted;
    });
  }

  async listPlans() {
    return this.prisma.plan.findMany({ orderBy: { createdAt: 'desc' } });
  }

  private pickPlanData(dto: CreatePlanDto | UpdatePlanDto): Record<string, unknown> {
    const allowed = ['name','type','technology','category','level','speedMbps','speedLabel','targetUsers','dataCapGb','fairUsageGb','priceKobo','installationFeeKobo','contentionRatio','staticIp','sla','routerIncluded','contractDuration','description','features','isActive'] as const;
    const out: Record<string, unknown> = {};
    for (const k of allowed) {
      const v = (dto as any)[k];
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  async createPlan(data: CreatePlanDto) {
    const tenantId = (await this.prisma.tenant?.findFirst())?.id;
    const safe = this.pickPlanData(data);
    const plan = await this.prisma.plan.create({ data: { tenantId, ...safe } as any });
    await this.audit.log({ action: 'PLAN_CREATED', entityType: 'Plan', entityId: plan.id, metadata: { name: (data as any).name, priceKobo: (data as any).priceKobo } });
    return plan;
  }

  async updatePlan(id: string, data: UpdatePlanDto) {
    const safe = this.pickPlanData(data);
    const plan = await this.prisma.plan.update({ where: { id }, data: safe as any });
    await this.audit.log({ action: 'PLAN_UPDATED', entityType: 'Plan', entityId: id, metadata: safe as any });
    return plan;
  }

  private static readonly PLAN_TYPES: Record<string, { type: 'RADIO' | 'FIBER' | 'ENTERPRISE'; technology: string }> = {
    radio: { type: 'RADIO', technology: 'RADIO' },
    fiber: { type: 'FIBER', technology: 'FIBER' },
    fibre: { type: 'FIBER', technology: 'FIBER' },
    dedicated: { type: 'ENTERPRISE', technology: 'DIA' },
    dia: { type: 'ENTERPRISE', technology: 'DIA' },
  };

  private static readonly PLAN_LEVELS = ['BRONZE', 'SILVER', 'GOLD'];

  /**
   * Import plans from an Excel/CSV file. Columns (case-insensitive):
   * Plan Name, Amount (Naira, optional decimal for kobo), Plan Type
   * (radio|fiber|dedicated), Plan Level (bronze|silver|gold), optional Speed (Mbps).
   * Existing plans with the same name are updated; new names are created.
   */
  async importPlans(file: Express.Multer.File) {
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

    const nameCol = findCol(['plan name', 'name', 'package']);
    const amountCol = findCol(['amount', 'price']);
    const typeCol = findCol(['plan type', 'type', 'technology']);
    const levelCol = findCol(['plan level', 'level', 'tier']);
    const speedCol = findCol(['speed', 'mbps', 'bandwidth']);

    if (!nameCol) throw new BadRequestException('Missing "Plan Name" column');
    if (!amountCol) throw new BadRequestException('Missing "Amount" column');
    if (!typeCol) throw new BadRequestException('Missing "Plan Type" column (radio, fiber, dedicated)');
    if (!levelCol) throw new BadRequestException('Missing "Plan Level" column (bronze, silver, gold)');

    const tenantId = (await this.prisma.tenant?.findFirst())?.id;

    const toKobo = (v: unknown): number | null => {
      if (v == null || v === '') return null;
      if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
      const cleaned = String(v).replace(/[₦,\s]/g, '');
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? Math.round(n * 100) : null;
    };

    const results: Array<{ row: number; name: string; status: 'created' | 'updated' | 'error'; reason?: string }> = [];
    let created = 0, updated = 0, errors = 0;

    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      const rowNo = i + 2;
      const name = String(r[nameCol] ?? '').trim();
      const rawType = norm(r[typeCol]);
      const typeInfo = SubscriptionsService.PLAN_TYPES[rawType];
      const level = norm(r[levelCol]).toUpperCase();
      const amount = toKobo(r[amountCol]);

      if (!name) { errors++; results.push({ row: rowNo, name: '', status: 'error', reason: 'missing plan name' }); continue; }
      if (!typeInfo) { errors++; results.push({ row: rowNo, name, status: 'error', reason: `invalid plan type "${String(r[typeCol] ?? '').trim()}" (use radio, fiber or dedicated)` }); continue; }
      if (!SubscriptionsService.PLAN_LEVELS.includes(level)) { errors++; results.push({ row: rowNo, name, status: 'error', reason: `invalid plan level "${String(r[levelCol] ?? '').trim()}" (use bronze, silver or gold)` }); continue; }
      if (amount == null || amount < 0) { errors++; results.push({ row: rowNo, name, status: 'error', reason: 'missing or invalid amount' }); continue; }

      const speedRaw = speedCol ? String(r[speedCol] ?? '').replace(/[^0-9.]/g, '') : '';
      const speedMbps = speedRaw ? Math.round(parseFloat(speedRaw)) || 0 : 0;
      const data = {
        name,
        type: typeInfo.type,
        technology: typeInfo.technology,
        category: `${typeInfo.technology}_${level}`,
        level,
        priceKobo: amount,
        speedMbps,
        isActive: true,
      };

      try {
        const existing = await this.prisma.plan.findFirst({
          where: { tenantId, name: { equals: name, mode: 'insensitive' } },
          select: { id: true },
        });
        if (existing) {
          await this.prisma.plan.update({ where: { id: existing.id }, data });
          await this.audit.log({ action: 'PLAN_UPDATED', entityType: 'Plan', entityId: existing.id, metadata: { source: 'import', name, priceKobo: amount } });
          updated++;
          results.push({ row: rowNo, name, status: 'updated' });
        } else {
          const plan = await this.prisma.plan.create({ data: { tenantId, ...data } });
          await this.audit.log({ action: 'PLAN_CREATED', entityType: 'Plan', entityId: plan.id, metadata: { source: 'import', name, priceKobo: amount } });
          created++;
          results.push({ row: rowNo, name, status: 'created' });
        }
      } catch (e: any) {
        errors++;
        results.push({ row: rowNo, name, status: 'error', reason: e?.message ?? 'failed to save plan' });
      }
    }

    return { total: raw.length, created, updated, errors, rows: results };
  }

  async createSubscription(data: { subscriberId: string; planId: string; autoRenew?: boolean; expiresAt: Date; installationFeeKobo?: number; routerProvided?: boolean; routerCostKobo?: number }) {
    const sub = await this.prisma.subscription.create({
      data: {
        subscriberId: data.subscriberId,
        planId: data.planId,
        autoRenew: data.autoRenew ?? true,
        expiresAt: data.expiresAt,
        installationFeeKobo: data.installationFeeKobo,
        routerProvided: data.routerProvided,
        routerCostKobo: data.routerCostKobo,
      },
      include: { plan: true, subscriber: { select: { id: true, userId: true } } },
    });
    await this.audit.log({ action: 'SUBSCRIPTION_CREATED', entityType: 'Subscription', entityId: sub.id, metadata: { subscriberId: data.subscriberId, planId: data.planId } });

    // Installation fee → raise an ISSUED installation invoice immediately so
    // the customer portal can gate access until it is paid.
    const installationFeeKobo = data.installationFeeKobo ?? 0;
    if (installationFeeKobo <= 0) return sub;
    const installationInvoice = await this.createInstallationInvoice(data.subscriberId, installationFeeKobo);
    return { ...sub, installationInvoice };
  }

  /** Creates the ISSUED INSTALLATION invoice with a collision-safe number. */
  private async createInstallationInvoice(subscriberId: string, amountKobo: number) {
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const last = await this.prisma.invoice.findFirst({
          where: { invoiceNumber: { startsWith: `INV-INS-${year}` } },
          orderBy: { createdAt: 'desc' },
        });
        const seq = last ? parseInt(last.invoiceNumber.split('-').pop()!, 10) + 1 : 1;
        const invoiceNumber = `INV-INS-${year}-${String(seq).padStart(6, '0')}`;
        return await this.prisma.invoice.create({
          data: {
            invoiceNumber,
            subscriberId,
            type: 'INSTALLATION',
            status: 'ISSUED',
            subtotalKobo: amountKobo,
            vatKobo: 0,
            discountKobo: 0,
            amountKobo,
            dueAt: new Date(Date.now() + 7 * 86400000),
            issuedAt: new Date(),
            lines: { createMany: { data: [{ description: 'Installation Fee', amountKobo, quantity: 1 }] } },
          },
          include: { lines: true },
        });
      } catch (e: any) {
        if (e?.code === 'P2002' && String(e?.meta?.target ?? '').includes('invoiceNumber')) continue;
        throw e;
      }
    }
    throw new Error('Could not allocate an installation invoice number');
  }

  async updateSubscription(id: string, data: { planId?: string; autoRenew?: boolean }) {
    const updated = await this.prisma.subscription.update({
      where: { id },
      data,
      include: { plan: true },
    });
    await this.audit.log({ action: 'SUBSCRIPTION_UPDATED', entityType: 'Subscription', entityId: id, metadata: data as any });
    return updated;
  }

  async removeSubscription(id: string, actor?: { id: string; isSuperAdmin?: boolean; customRole?: { name: string } | null }) {
    if (actor) {
      this.audit.assertNotMaker(actor, await this.audit.makerOf('Subscription', id), 'subscription');
    }
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: { cancelledAt: new Date() },
    });
    await this.audit.log({ action: 'SUBSCRIPTION_CANCELLED', entityType: 'Subscription', entityId: id });
    return updated;
  }
}
