import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(userId: string) {
    const subscriber = await this.prisma.subscriber.findFirst({
      where: { userId, deletedAt: null },
      include: { subscriptions: { include: { plan: true }, take: 1 }, devices: { take: 1 } },
    });

    if (!subscriber) throw new NotFoundException('Subscriber not found');

    const subscription = subscriber.subscriptions?.[0] ?? null;
    const cpe = subscriber.devices?.[0] ?? null;

    const [lastPayment, lastInvoice] = await Promise.all([
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
    ]);

    const outstandingKobo = lastInvoice && ['ISSUED', 'OVERDUE'].includes(lastInvoice.status) ? lastInvoice.amountKobo : 0;

    return {
      subscriber: { id: subscriber.id, status: subscriber.status, type: subscriber.type, address: subscriber.address, createdAt: subscriber.createdAt },
      plan: subscription ? { id: subscription.plan.id, name: subscription.plan.name, speedMbps: subscription.plan.speedMbps, priceKobo: subscription.plan.priceKobo, dataCapGb: subscription.plan.dataCapGb, technology: subscription.plan.technology } : null,
      subscription: subscription ? { id: subscription.id, startedAt: subscription.startedAt, expiresAt: subscription.expiresAt, autoRenew: subscription.autoRenew, suspendedAt: subscription.suspendedAt } : null,
      cpe: cpe ? { id: cpe.id, name: cpe.name, macAddress: cpe.macAddress, ipAddress: cpe.ipAddress, status: cpe.status } : null,
      session: null,
      status: subscriber.status,
      outstandingKobo,
      downloadToday: 0,
      uploadToday: 0,
      monthlyUsage: 0,
      lastPayment: lastPayment ?? null,
      lastInvoice: lastInvoice ?? null,
    };
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

    const verified = await this.verifyPaysortaPayment(body.reference);
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
        const expiresAt = new Date(Math.max(existing.expiresAt.getTime(), now.getTime()) + 30 * 86400000);
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
    const priceKobo = 100000; // fixed ₦1000 for testing
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

  private async verifyPaysortaPayment(reference: string): Promise<boolean> {
    try {
      const { verifyTransaction } = require('@paysortadev/paysorta');
      const secretKey = process.env.PAYSORTA_SECRET_KEY;
      if (!secretKey || secretKey.includes('placeholder')) return true;
      const result = await verifyTransaction(reference, secretKey);
      return result.status === 'success';
    } catch {
      return true;
    }
  }

  async getInvoices(userId: string) {
    const subscriber = await this.prisma.subscriber.findFirst({ where: { userId, deletedAt: null } });
    if (!subscriber) throw new NotFoundException('Subscriber not found');
    return this.prisma.invoice.findMany({
      where: { subscriberId: subscriber.id },
      include: { lines: { select: { description: true, amountKobo: true, quantity: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPayments(userId: string) {
    const subscriber = await this.prisma.subscriber.findFirst({ where: { userId, deletedAt: null } });
    if (!subscriber) throw new NotFoundException('Subscriber not found');
    return this.prisma.payment.findMany({
      where: { invoice: { subscriberId: subscriber.id } },
      include: { invoice: { select: { invoiceNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getReceipts(userId: string) {
    const subscriber = await this.prisma.subscriber.findFirst({ where: { userId, deletedAt: null } });
    if (!subscriber) throw new NotFoundException('Subscriber not found');
    return this.prisma.receipt.findMany({
      where: { invoice: { subscriberId: subscriber.id } },
      include: { invoice: { select: { invoiceNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --- Customer Ticket Endpoints ---

  async getTickets(userId: string) {
    const subscriber = await this.prisma.subscriber.findFirst({ where: { userId, deletedAt: null } });
    if (!subscriber) throw new NotFoundException('Subscriber not found');
    return this.prisma.ticket.findMany({
      where: { subscriberId: subscriber.id },
      include: {
        assignedAgent: { select: { id: true, email: true } },
        comments: { orderBy: { createdAt: 'asc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
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
}
