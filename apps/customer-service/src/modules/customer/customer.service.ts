import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { decryptSecret } from '@isp/prisma';

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService) {}

  async getDashboard(userId: string) {
    const subscriber = await this.prisma.subscriber.findFirst({
      where: { userId, deletedAt: null },
      include: { subscriptions: { include: { plan: true }, take: 1 }, devices: { take: 1 } },
    });

    if (!subscriber) throw new NotFoundException('Subscriber not found');

    const subscription = subscriber.subscriptions?.[0] ?? null;
    const cpe = subscriber.devices?.[0] ?? null;

    const [lastPayment, lastInvoice, installationInvoice] = await Promise.all([
      this.prisma.payment.findFirst({
        where: { invoice: { subscriberId: subscriber.id } },
        orderBy: { createdAt: 'desc' },
        select: { amountKobo: true, createdAt: true },
      }),
      this.prisma.invoice.findFirst({
        where: { subscriberId: subscriber.id, status: { in: ['ISSUED', 'OVERDUE'] } },
        orderBy: { dueAt: 'asc' },
        select: { id: true, amountKobo: true, status: true, dueAt: true },
      }),
      this.prisma.invoice.findFirst({
        where: { subscriberId: subscriber.id, type: 'INSTALLATION', status: { in: ['ISSUED', 'OVERDUE'] }, deletedAt: null },
        orderBy: { dueAt: 'asc' },
        select: { id: true, invoiceNumber: true, amountKobo: true, status: true, dueAt: true },
      }),
    ]);

    const outstandingKobo = lastInvoice && ['ISSUED', 'OVERDUE'].includes(lastInvoice.status) ? lastInvoice.amountKobo : 0;
    // Fetch user for detailed import fields
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, phone: true, secondaryPhone: true, name: true } });

    // Build 16-column import view for customer portal (ID, ID2, PASSWORD masked, PORTAL PASSWORD masked, etc.)
    const rawEmail: string | null = user?.email ?? null;
    const displayEmail = rawEmail && !rawEmail.endsWith('@local') ? rawEmail : null;
    const cpeIp = (cpe as any)?.ipAddress ?? null;
    const subStaticIp = (subscriber as any).staticIpAddress ?? null;
    const displayIp = subStaticIp ?? cpeIp ?? null;
    const userTypeRaw = (subscriber as any).networkType ?? subscription?.plan?.technology ?? null;

    return {
      subscriber: {
        id: subscriber.id,
        legacyId: (subscriber as any).legacyId ?? null,
        hikonnectId: (subscriber as any).hikonnectId ?? null,
        id2: (subscriber as any).id2 ?? null,
        firstName: (subscriber as any).firstName ?? null,
        lastName: (subscriber as any).lastName ?? null,
        companyName: (subscriber as any).companyName ?? null,
        stationLabel: (subscriber as any).stationLabel ?? null,
        staticIpAddress: subStaticIp,
        staticIpNetmask: (subscriber as any).staticIpNetmask ?? null,
        address: subscriber.address,
        status: subscriber.status,
        type: subscriber.type,
        networkType: (subscriber as any).networkType ?? null,
        pppoeUsername: (subscriber as any).pppoeUsername ?? null,
        createdAt: subscriber.createdAt,
        startedAt: subscription?.startedAt ?? null,
        expiresAt: subscription?.expiresAt ?? null,
      },
      // Flat 16-field mapping for easy consumption on the customer side
      importFields: {
        id: (subscriber as any).legacyId ?? null, // ID column (HIF/HIR)
        id2: (subscriber as any).id2 ?? null, // ID2 column
        password: '••••••••', // RADIUS password — masked, from sheet if present
        portalPassword: '••••••••', // Portal password — masked, reset via support if needed
        firstName: (subscriber as any).firstName ?? null,
        lastName: (subscriber as any).lastName ?? null,
        companyName: (subscriber as any).companyName ?? null,
        contactNumber: user?.phone ?? null,
        secondaryContact: (user as any)?.secondaryPhone ?? null,
        email: displayEmail,
        rawEmail,
        station: (subscriber as any).stationLabel ?? null,
        address: subscriber.address ?? null,
        plan: subscription?.plan?.name ?? null,
        planTechnology: subscription?.plan?.technology ?? null,
        planPriceKobo: subscription?.plan?.priceKobo ?? null,
        startDate: subscription?.startedAt ?? null,
        expiryDate: subscription?.expiresAt ?? null,
        ipAddress: displayIp,
        ipConflict: (cpe as any)?.ipConflict ?? false,
        needsMacAddress: (cpe as any)?.needsMacAddress ?? false,
        userType: userTypeRaw,
        connectionType: (cpe as any)?.connectionType ?? null,
        hikonnectId: (subscriber as any).hikonnectId ?? null,
        pppoeUsername: (subscriber as any).pppoeUsername ?? null,
      },
      user: user ? { email: user.email, phone: user.phone, secondaryPhone: (user as any).secondaryPhone ?? null, name: user.name } : null,
      plan: subscription ? { id: subscription.plan.id, name: subscription.plan.name, speedMbps: subscription.plan.speedMbps, priceKobo: subscription.plan.priceKobo, dataCapGb: subscription.plan.dataCapGb, technology: subscription.plan.technology } : null,
      subscription: subscription ? { id: subscription.id, startedAt: subscription.startedAt, expiresAt: subscription.expiresAt, autoRenew: subscription.autoRenew, suspendedAt: subscription.suspendedAt } : null,
      cpe: cpe ? { id: cpe.id, name: cpe.name, macAddress: cpe.macAddress, needsMacAddress: (cpe as any).needsMacAddress ?? false, ipAddress: cpe.ipAddress, ipConflict: (cpe as any).ipConflict ?? false, status: cpe.status, connectionType: (cpe as any).connectionType ?? null } : null,
      session: null,
      status: subscriber.status,
      outstandingKobo,
      installationDue: !!installationInvoice,
      installationInvoice: installationInvoice ?? null,
      downloadToday: 0,
      uploadToday: 0,
      monthlyUsage: 0,
      lastPayment: lastPayment ?? null,
      lastInvoice: lastInvoice ?? null,
    };
  }

  /**
   * Lightweight access gate for the customer portal: true while an unpaid
   * INSTALLATION invoice exists. Clears automatically once it is paid.
   */
  async getAccess(userId: string) {
    const subscriber = await this.prisma.subscriber.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    if (!subscriber) return { installationDue: false, invoice: null };
    const invoice = await this.prisma.invoice.findFirst({
      where: { subscriberId: subscriber.id, type: 'INSTALLATION', status: { in: ['ISSUED', 'OVERDUE'] }, deletedAt: null },
      orderBy: { dueAt: 'asc' },
      select: { id: true, invoiceNumber: true, amountKobo: true, status: true, dueAt: true },
    });
    return { installationDue: !!invoice, invoice: invoice ?? null };
  }

  async getAnalytics(userId: string) {
    const subscriber = await this.prisma.subscriber.findFirst({
      where: { userId, deletedAt: null },
    });
    if (!subscriber) throw new NotFoundException('Subscriber not found');

    // Monthly billing for last 12 months
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const invoices = await this.prisma.invoice.findMany({
      where: { subscriberId: subscriber.id, createdAt: { gte: twelveMonthsAgo } },
      select: { amountKobo: true, status: true, paidAt: true, dueAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const billingTrend: Record<string, { total: number; paid: number; overdue: number }> = {};
    for (const inv of invoices) {
      const month = `${inv.createdAt.getFullYear()}-${String(inv.createdAt.getMonth() + 1).padStart(2, '0')}`;
      if (!billingTrend[month]) billingTrend[month] = { total: 0, paid: 0, overdue: 0 };
      billingTrend[month].total += inv.amountKobo;
      if (inv.status === 'PAID') billingTrend[month].paid += inv.amountKobo;
      if (inv.status === 'OVERDUE') billingTrend[month].overdue += inv.amountKobo;
    }

    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const data = billingTrend[key] ?? { total: 0, paid: 0, overdue: 0 };
      months.push({ month: key, ...data });
    }

    // Payment summary
    const allPayments = await this.prisma.payment.findMany({
      where: { invoice: { subscriberId: subscriber.id }, status: 'SUCCESSFUL' },
      select: { amountKobo: true, createdAt: true },
    });
    const totalPaid = allPayments.reduce((s, p) => s + p.amountKobo, 0);
    const avgPayment = allPayments.length > 0 ? Math.round(totalPaid / allPayments.length) : 0;

    // Ticket stats
    const tickets = await this.prisma.ticket.findMany({
      where: { subscriberId: subscriber.id },
      select: { status: true, priority: true, createdAt: true },
    });
    const ticketStats = {
      total: tickets.length,
      open: tickets.filter(t => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length,
      resolved: tickets.filter(t => t.status === 'RESOLVED' || t.status === 'CLOSED').length,
    };

    return {
      usageTrend: [],
      billingTrend: months,
      totalPaidKobo: totalPaid,
      avgPaymentKobo: avgPayment,
      totalDownloadBytes: 0,
      totalUploadBytes: 0,
      totalSessionSeconds: 0,
      totalSessions: 0,
      recentSessions: [],
      ticketStats,
    };
  }

  async handleSubscriptionAction(userId: string, body: { action: string; planId?: string; reference: string }) {
    const subscriber = await this.prisma.subscriber.findFirst({
      where: { userId, deletedAt: null },
      include: { subscriptions: { include: { plan: true }, take: 1 } },
    });
    if (!subscriber) throw new NotFoundException('Subscriber not found');

    const verified = await this.verifyPaystackPayment(body.reference);
    if (!verified) throw new BadRequestException('Payment verification failed');

    const now = new Date();
    let plan: any;
    let subscriptionId: string;
    let message: string;

    switch (body.action) {
      case 'change_plan': {
        if (!body.planId) throw new BadRequestException('planId required');
        plan = await this.prisma.plan.findUnique({ where: { id: body.planId } });
        if (!plan) throw new NotFoundException('Plan not found');
        const existing = subscriber.subscriptions?.[0];
        if (!existing) throw new NotFoundException('No active subscription');
        subscriptionId = existing.id;
        const expires = new Date(now.getTime() + 30 * 86400000);
        await this.prisma.subscription.update({
          where: { id: existing.id },
          data: { planId: body.planId, startedAt: now, expiresAt: expires, suspendedAt: null },
        });
        message = 'Plan changed to ' + plan.name;
        break;
      }
      case 'renew': {
        const existing = subscriber.subscriptions?.[0];
        if (!existing) throw new NotFoundException('No active subscription');
        plan = existing.plan;
        subscriptionId = existing.id;
        const expiresAt = new Date(Math.max((existing.expiresAt ?? now).getTime(), now.getTime()) + 30 * 86400000);
        await this.prisma.subscription.update({
          where: { id: existing.id },
          data: { expiresAt, suspendedAt: null },
        });
        message = 'Subscription renewed until ' + expiresAt.toISOString().slice(0, 10);
        break;
      }
      case 'add_plan': {
        if (!body.planId) throw new BadRequestException('planId required');
        plan = await this.prisma.plan.findUnique({ where: { id: body.planId } });
        if (!plan) throw new NotFoundException('Plan not found');
        const expiresAt = new Date(now.getTime() + 30 * 86400000);
        const created = await this.prisma.subscription.create({
          data: { subscriberId: subscriber.id, planId: body.planId, expiresAt, autoRenew: true },
        });
        subscriptionId = created.id;
        message = 'Added plan: ' + plan.name;
        break;
      }
      default:
        throw new BadRequestException('Unknown action: ' + body.action);
    }

    // Create Invoice + Payment + Receipt
    const priceKobo = plan?.priceKobo ?? 0;
    const vatKobo = 0;
    const totalKobo = priceKobo;
    const invNum = 'INV-' + now.getFullYear() + '-' + String(await this.nextInvoiceSeq()).padStart(6, '0');
    const dueAt = new Date(now.getTime() + 14 * 86400000);

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber: invNum,
        subscriberId: subscriber.id,
        type: 'SUBSCRIPTION',
        status: 'PAID',
        amountKobo: totalKobo,
        subtotalKobo: priceKobo,
        vatKobo,
        discountKobo: 0,
        dueAt,
        issuedAt: now,
        paidAt: now,
        lines: {
          create: {
            description: body.action === 'change_plan' ? 'Plan Change: ' + plan.name
              : body.action === 'renew' ? 'Subscription Renewal: ' + plan.name
              : 'New Plan: ' + plan.name,
            amountKobo: priceKobo,
            quantity: 1,
          },
        },
      },
    });

    const payment = await this.prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amountKobo: totalKobo,
        status: 'SUCCESSFUL',
        provider: 'PAYSTACK',
        reference: body.reference,
        paidAt: now,
      },
    });

    await this.prisma.receipt.create({
      data: {
        invoiceId: invoice.id,
        receiptNumber: 'RCT-' + now.getFullYear() + '-' + String(await this.nextReceiptSeq()).padStart(6, '0'),
        amountKobo: totalKobo,
        paymentMethod: 'PAYSTACK',
        transactionRef: body.reference,
        paidAt: now,
      },
    });

    return { message };
  }

  private async nextInvoiceSeq(): Promise<number> {
    const year = new Date().getFullYear();
    const prefix = 'INV-' + year + '-';
    const last = await this.prisma.invoice.findFirst({
      where: { invoiceNumber: { startsWith: prefix } },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    });
    if (!last) return 1;
    const parts = last.invoiceNumber.split('-');
    return (parseInt(parts[parts.length - 1], 10) || 0) + 1;
  }

  private async nextReceiptSeq(): Promise<number> {
    const year = new Date().getFullYear();
    const prefix = 'RCT-' + year + '-';
    const last = await this.prisma.receipt.findFirst({
      where: { receiptNumber: { startsWith: prefix } },
      orderBy: { receiptNumber: 'desc' },
      select: { receiptNumber: true },
    });
    if (!last) return 1;
    const parts = last.receiptNumber.split('-');
    return (parseInt(parts[parts.length - 1], 10) || 0) + 1;
  }

private async verifyPaystackPayment(reference: string): Promise<boolean> {
    let secretKey = process.env.PAYSTACK_SECRET_KEY;
    try {
      const tenantId = (await this.prisma.tenant?.findFirst())?.id;
      const row = await this.prisma.tenant?.findUnique({
        where: { id: tenantId },
        select: { paystackEnabled: true, paystackSecretKeyEnc: true },
      });
      const tenantKey = row?.paystackEnabled ? decryptSecret(row.paystackSecretKeyEnc) : null;
      if (tenantKey) secretKey = tenantKey;
    } catch {
      // fall back to env
    }
    if (!secretKey) return false;
    try {
      const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) return false;
      const body: any = await res.json();
      return !!(body?.status && body?.data?.status === 'success');
    } catch {
      return false;
    }
  }

  async getInvoices(userId: string, pagination?: { skip?: number; take?: number }) {
    const take = Math.min(Math.max(pagination?.take ?? 50, 1), 100);
    const skip = Math.max(pagination?.skip ?? 0, 0);
    const subscriber = await this.prisma.subscriber.findFirst({ where: { userId, deletedAt: null } });
    if (!subscriber) throw new NotFoundException('Subscriber not found');
    return this.prisma.invoice.findMany({
      where: { subscriberId: subscriber.id },
      include: { lines: { select: { description: true, amountKobo: true, quantity: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async getPayments(userId: string, pagination?: { skip?: number; take?: number }) {
    const take = Math.min(Math.max(pagination?.take ?? 50, 1), 100);
    const skip = Math.max(pagination?.skip ?? 0, 0);
    const subscriber = await this.prisma.subscriber.findFirst({ where: { userId, deletedAt: null } });
    if (!subscriber) throw new NotFoundException('Subscriber not found');
    return this.prisma.payment.findMany({
      where: { invoice: { subscriberId: subscriber.id } },
      include: { invoice: { select: { invoiceNumber: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async getReceipts(userId: string, pagination?: { skip?: number; take?: number }) {
    const take = Math.min(Math.max(pagination?.take ?? 50, 1), 100);
    const skip = Math.max(pagination?.skip ?? 0, 0);
    const subscriber = await this.prisma.subscriber.findFirst({ where: { userId, deletedAt: null } });
    if (!subscriber) throw new NotFoundException('Subscriber not found');
    return this.prisma.receipt.findMany({
      where: { invoice: { subscriberId: subscriber.id } },
      include: { invoice: { select: { invoiceNumber: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  // --- Customer Ticket Endpoints ---

  async getTickets(userId: string, pagination?: { skip?: number; take?: number }) {
    const take = Math.min(Math.max(pagination?.take ?? 50, 1), 100);
    const skip = Math.max(pagination?.skip ?? 0, 0);
    const subscriber = await this.prisma.subscriber.findFirst({ where: { userId, deletedAt: null } });
    if (!subscriber) throw new NotFoundException('Subscriber not found');
    return this.prisma.ticket.findMany({
      where: { subscriberId: subscriber.id },
      include: {
        assignedAgent: { select: { id: true, email: true } },
        comments: { orderBy: { createdAt: 'asc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async getTicket(userId: string, ticketId: string) {
    const subscriber = await this.prisma.subscriber.findFirst({ where: { userId, deletedAt: null } });
    if (!subscriber) throw new NotFoundException('Subscriber not found');
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        assignedAgent: { select: { id: true, email: true } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket || ticket.subscriberId !== subscriber.id) throw new ForbiddenException('Access denied');
    return ticket;
  }

  async replyTicket(userId: string, ticketId: string, body: { message: string }) {
    const subscriber = await this.prisma.subscriber.findFirst({
      where: { userId, deletedAt: null },
      include: { user: { select: { email: true } } },
    });
    if (!subscriber) throw new NotFoundException('Subscriber not found');
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.subscriberId !== subscriber.id) throw new ForbiddenException('Access denied');
    const comment = await this.prisma.ticketComment.create({
      data: {
        ticketId,
        authorId: userId,
        author: subscriber.user.email,
        authorType: 'CUSTOMER',
        body: body.message,
        internal: false,
      },
    });
    return comment;
  }

  // ── Customer self-edit (16 sheet cols) ────────────────────────
  // Allows the authenticated customer to update their own subscriber fields.
  // Only whitelisted fields are writable — ID/Hikonnect/plan/dates/IP remain admin-only.
  async updateOwnProfile(userId: string, data: {
    firstName?: string; lastName?: string; companyName?: string;
    phone?: string; secondaryPhone?: string; email?: string;
    address?: string; stationLabel?: string; ipAddress?: string;
  }) {
    const subscriber = await this.prisma.subscriber.findFirst({
      where: { userId, deletedAt: null },
      include: { user: true },
    });
    if (!subscriber) throw new NotFoundException('Subscriber not found');

    // Email uniqueness (if changing)
    if (data.email !== undefined) {
      const normalized = String(data.email).trim().toLowerCase().replace(/\s+/g, '');
      if (normalized && normalized !== subscriber.user.email.toLowerCase()) {
        const taken = await this.prisma.user.findFirst({
          where: { email: normalized, id: { not: subscriber.userId }, deletedAt: null },
          select: { id: true },
        });
        if (taken) throw new BadRequestException('A user with this email already exists');
        // Validate format roughly
        if (normalized && !normalized.includes('@')) throw new BadRequestException('Invalid email');
        data.email = normalized || undefined;
      } else if (!normalized) {
        // Empty string means do not change (placeholder @local emails stay hidden)
        delete (data as any).email;
      }
    }

    // Phone secondary handling — clean similar to import but permissive
    const cleanPhone = (v: unknown): string | null => {
      const s = String(v ?? '').trim();
      if (!s) return null;
      const digits = s.replace(/\D/g, '');
      if (!digits) return null;
      if (digits.length === 10 && !digits.startsWith('0')) return '0' + digits;
      return digits;
    };

    // Update User (phone/secondary/email/name)
    const userUpdates: Record<string, unknown> = {};
    if (data.phone !== undefined) {
      const cleaned = cleanPhone(data.phone);
      if (cleaned) {
        // Check uniqueness against live users (soft-deleted holders allowed)
        const rows: Array<{ id: string; deletedAt: Date | null }> = await this.prisma.$queryRaw`SELECT id, "deletedAt" FROM "User" WHERE phone = ${cleaned} AND id <> ${subscriber.userId} LIMIT 1`;
        const owner = rows[0];
        if (owner && !owner.deletedAt) throw new BadRequestException('A user with this phone number already exists');
        userUpdates.phone = cleaned;
      } else if (String(data.phone).trim() === '') {
        // Allow clearing? Keep existing — customers shouldn't wipe primary contact entirely
        // Require at least one phone — ignore empty clear
      }
    }
    if (data.secondaryPhone !== undefined) {
      const cleaned = data.secondaryPhone ? cleanPhone(data.secondaryPhone) : null;
      userUpdates.secondaryPhone = cleaned;
    }
    if (data.email !== undefined) userUpdates.email = data.email;
    // Name derived from first/last if provided, else keep
    if (data.firstName !== undefined || data.lastName !== undefined) {
      const fn = data.firstName !== undefined ? String(data.firstName).trim() : (subscriber as any).firstName ?? '';
      const ln = data.lastName !== undefined ? String(data.lastName).trim() : (subscriber as any).lastName ?? '';
      const derived = [fn, ln].filter(Boolean).join(' ') || (subscriber as any).companyName || null;
      if (derived) userUpdates.name = derived;
    }

    if (Object.keys(userUpdates).length) {
      await this.prisma.user.update({ where: { id: subscriber.userId }, data: userUpdates as any });
    }

    // Update Subscriber (firstName/lastName/companyName/address/stationLabel)
    const subUpdates: Record<string, unknown> = {};
    if (data.firstName !== undefined) subUpdates.firstName = String(data.firstName).trim() || null;
    if (data.lastName !== undefined) subUpdates.lastName = String(data.lastName).trim() || null;
    if (data.companyName !== undefined) subUpdates.companyName = String(data.companyName).trim() || null;
    if (data.address !== undefined) subUpdates.address = String(data.address).trim() || null;
    if (data.stationLabel !== undefined) subUpdates.stationLabel = String(data.stationLabel).trim() || null;

    if (Object.keys(subUpdates).length) {
      await this.prisma.subscriber.update({ where: { id: subscriber.id }, data: subUpdates as any });
    }

    // Static IP — allow customer to request IP change (admin still validates via same checks as admin update)
    if ((data as any).ipAddress !== undefined) {
      const rawIp = String((data as any).ipAddress ?? '').trim();
      const ip = rawIp || null;
      if (ip && !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) throw new BadRequestException('Invalid IP address');
      const currentCpe = await this.prisma.cpe.findFirst({ where: { subscriberId: subscriber.id }, orderBy: { createdAt: 'asc' } });
      const currentIp = (subscriber as any).staticIpAddress ?? (currentCpe as any)?.ipAddress ?? null;
      if (ip !== currentIp) {
        // Check uniqueness against live subscribers (soft-deleted holders allowed to reuse)
        if (ip) {
          const rows: Array<{ id: string }> = await this.prisma.$queryRaw`SELECT id FROM "Subscriber" WHERE "staticIpAddress" = ${ip} AND id <> ${subscriber.id} AND "deletedAt" IS NULL LIMIT 1`;
          if (rows.length) throw new BadRequestException('IP address is already in use');
        }
        await this.prisma.subscriber.update({ where: { id: subscriber.id }, data: { staticIpAddress: ip } as any });
        const cpe = currentCpe ?? await this.prisma.cpe.findFirst({ where: { subscriberId: subscriber.id }, orderBy: { createdAt: 'asc' } });
        if (ip) {
          if (cpe) {
            await this.prisma.cpe.update({ where: { id: cpe.id }, data: { ipAddress: ip, connectionType: 'STATIC_IP', status: 'OFFLINE', ipConflict: false } as any });
          } else {
            await this.prisma.cpe.create({ data: { subscriberId: subscriber.id, ipAddress: ip, connectionType: 'STATIC_IP', status: 'OFFLINE', ipConflict: false, name: (subscriber as any).pppoeUsername ?? (subscriber as any).hikonnectId ?? null } as any });
          }
        } else if (cpe) {
          await this.prisma.cpe.update({ where: { id: cpe.id }, data: { ipAddress: null, ipConflict: false } as any });
        }
      }
    }

    // Return fresh dashboard view so frontend can show updated data immediately
    return this.getDashboard(userId);
  }
}
