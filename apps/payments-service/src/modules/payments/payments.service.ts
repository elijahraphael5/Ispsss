import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../audit-logs/audit.service';
import { MailService } from '../mail/mail.service';
import { PaystackProvider } from './providers/paystack.provider';
import { GatewayConfigService } from './gateway-config.service';
import { RadiusClientService } from '../radius/radius-client.service';
import * as crypto from 'crypto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
    private readonly paystack: PaystackProvider,
    private readonly radius: RadiusClientService,
    private readonly mail: MailService,
    private readonly gatewayKeys: GatewayConfigService,
  ) {}

  private async notifyRadiusActivation(invoiceId: string): Promise<void> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { subscriberId: true },
      });
      if (!invoice) {
        this.logger.warn(`RADIUS activation skipped: invoice ${invoiceId} not found`);
        return;
      }
      await this.radius.activate(invoice.subscriberId);
    } catch (err: any) {
      this.logger.warn(`RADIUS activation for invoice ${invoiceId} failed: ${err?.message ?? err}`);
    }
  }

  // ── Dashboard ──────────────────────────────────────────────

  async getDashboard() {
    const now = new Date();
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const todayStr = now.toISOString().slice(0, 10);
    const startToday = new Date(todayStr);

    const [revenueToday, revenueWeek, revenueMonth, revenueYear, statusCounts, gatewayStats] = await Promise.all([
      this.prisma.payment.aggregate({ where: { status: 'SUCCESSFUL', paidAt: { gte: startToday } }, _sum: { amountKobo: true } }),
      this.prisma.payment.aggregate({ where: { status: 'SUCCESSFUL', paidAt: { gte: startOfWeek } }, _sum: { amountKobo: true } }),
      this.prisma.payment.aggregate({ where: { status: 'SUCCESSFUL', paidAt: { gte: startOfMonth } }, _sum: { amountKobo: true } }),
      this.prisma.payment.aggregate({ where: { status: 'SUCCESSFUL', paidAt: { gte: startOfYear } }, _sum: { amountKobo: true } }),
      this.prisma.payment.groupBy({ by: ['status'], _count: { id: true }, _sum: { amountKobo: true } }),
      this.prisma.payment.groupBy({ by: ['provider'], _count: { id: true }, where: { status: 'SUCCESSFUL' } }),
    ]);

    const statusMap: Record<string, { count: number; amount: number }> = {};
    for (const row of statusCounts) statusMap[row.status] = { count: row._count.id, amount: row._sum.amountKobo ?? 0 };

    return {
      revenueToday: revenueToday._sum.amountKobo ?? 0,
      revenueThisWeek: revenueWeek._sum.amountKobo ?? 0,
      revenueThisMonth: revenueMonth._sum.amountKobo ?? 0,
      revenueThisYear: revenueYear._sum.amountKobo ?? 0,
      payments: {
        successful: statusMap.SUCCESSFUL?.count ?? 0,
        failed: statusMap.FAILED?.count ?? 0,
        pending: statusMap.PENDING?.count ?? 0,
        refunded: statusMap.REFUNDED?.count ?? 0,
      },
      gatewayStats: gatewayStats.map(g => ({
        provider: g.provider,
        count: g._count.id,
      })),
    };
  }

  // ── List / Find ────────────────────────────────────────────

  async findAll(filters?: { status?: string; provider?: string; search?: string; limit?: number }) {
    const where: any = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.provider) where.provider = filters.provider;
    if (filters?.search) {
      where.OR = [
        { reference: { contains: filters.search, mode: 'insensitive' } },
        { providerReference: { contains: filters.search, mode: 'insensitive' } },
        { invoice: { invoiceNumber: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.payment.findMany({
      where,
      include: {
        invoice: { select: { id: true, invoiceNumber: true, amountKobo: true, subscriber: { select: { user: { select: { email: true, phone: true } } } } } },
        refunds: true,
      },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit,
    });
  }

  async findOne(id: string) {
    const p = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: { include: { lines: true, subscriber: { select: { id: true, user: { select: { email: true, phone: true } } } } } },
        refunds: true,
      },
    });
    if (!p) throw new NotFoundException('Payment not found');
    return p;
  }

  // ── Initialize Payment ─────────────────────────────────────

  async initialize(data: { invoiceId: string; email: string; amountKobo?: number; callbackUrl?: string }) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: data.invoiceId } });
    if (invoice.status === 'PAID') throw new BadRequestException('Invoice already paid');

    const amount = data.amountKobo ?? invoice.amountKobo;
    const reference = `PAY-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const payment = await this.prisma.payment.create({
      data: { invoiceId: data.invoiceId, provider: 'PAYSTACK', amountKobo: amount, reference, status: 'PENDING' },
    });

    try {
      const result = await this.paystack.initializeTransaction({
        email: data.email,
        amountKobo: amount,
        reference,
        callbackUrl: data.callbackUrl,
        metadata: { invoiceId: data.invoiceId, paymentId: payment.id },
      });

      await this.prisma.paymentAttempt.create({
        data: { paymentId: payment.id, provider: 'PAYSTACK', reference, status: 'PENDING', response: { action: 'initialize' } },
      });

      return { authorizationUrl: result.authorizationUrl, reference, paymentId: payment.id };
    } catch (err: any) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
      throw new BadRequestException(`Payment initialization failed: ${err.message}`);
    }
  }

  // ── Customer Self-Service Checkout (Paystack) ──────────────

  /** Allowed pay-ahead durations (months). */
  private static readonly PAY_AHEAD_MONTHS = [1, 2, 3, 4, 5, 6, 9, 12];

  private normalizeMonths(months?: number): number {
    const n = Number(months ?? 1);
    return PaymentsService.PAY_AHEAD_MONTHS.includes(n) ? n : 1;
  }

  /** Calendar-aware month addition, clamped to the last day of the target month. */
  private addMonths(date: Date, months: number): Date {
    const d = new Date(date);
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() < day) d.setDate(0);
    return d;
  }

  async initializeCustomerPayment(userId: string, body: { action: 'renew' | 'change_plan' | 'add_plan' | 'pay_invoice'; planId?: string; invoiceId?: string; email?: string; months?: number }) {
    const subscriber = await this.prisma.subscriber.findFirst({
      where: { userId, deletedAt: null },
      include: { user: { select: { email: true } } },
    });
    if (!subscriber) throw new NotFoundException('Subscriber not found');

    const { action, planId } = body;
    const months = Number(body.months ?? 1);
    if (!PaymentsService.PAY_AHEAD_MONTHS.includes(months)) {
      throw new BadRequestException('months must be one of 1, 2, 3, 4, 5, 6, 9 or 12');
    }

    const callbackUrl = (process.env.CUSTOMER_URL ?? 'http://localhost:3001') + '/payment/callback';

    // Pay an existing ISSUED/OVERDUE invoice — no subscription change.
    if (action === 'pay_invoice') {
      if (!body.invoiceId) throw new BadRequestException('invoiceId required');
      const invoice = await this.prisma.invoice.findFirst({
        where: { id: body.invoiceId, subscriberId: subscriber.id, deletedAt: null },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (!['ISSUED', 'OVERDUE'].includes(invoice.status)) {
        throw new BadRequestException('This invoice is not payable');
      }

      const reference = 'PAY-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
      const payment = await this.prisma.payment.create({
        data: { invoiceId: invoice.id, provider: 'PAYSTACK', amountKobo: invoice.amountKobo, reference, status: 'PENDING' },
      });

      try {
        const result = await this.paystack.initializeTransaction({
          email: body.email ?? subscriber.user?.email ?? '',
          amountKobo: invoice.amountKobo,
          reference,
          callbackUrl,
          metadata: { action, invoiceId: invoice.id, paymentId: payment.id },
        });
        await this.prisma.paymentAttempt.create({
          data: {
            paymentId: payment.id,
            provider: 'PAYSTACK',
            reference,
            status: 'PENDING',
            response: { action: 'initialize', meta: { action, invoiceId: invoice.id } },
          },
        });
        return { authorizationUrl: result.authorizationUrl, reference, amountKobo: invoice.amountKobo, months: 1, paymentId: payment.id, invoiceId: invoice.id };
      } catch (err: any) {
        await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
        throw new BadRequestException(`Payment initialization failed: ${err.message}`);
      }
    }

    let plan: any = null;
    if (action === 'renew') {
      const current = await this.prisma.subscription.findFirst({
        where: { subscriberId: subscriber.id },
        include: { plan: true },
        orderBy: { startedAt: 'desc' },
      });
      plan = current?.plan ?? null;
      if (!plan) throw new NotFoundException('No active subscription to renew');
    } else {
      if (!planId) throw new BadRequestException('planId required');
      plan = await this.prisma.plan.findUnique({ where: { id: planId } });
      if (!plan) throw new NotFoundException('Plan not found');
    }

    const priceKobo = plan.priceKobo * months;
    const now = new Date();
    const baseLabel =
      action === 'change_plan' ? 'Plan Change: ' + plan.name
      : action === 'renew' ? 'Renewal: ' + plan.name
      : 'New Plan: ' + plan.name;
    const lineDescription = months > 1 ? `${baseLabel} (${months} months)` : baseLabel;

    const invoice = await this.createInvoiceWithUniqueNumber({
      subscriberId: subscriber.id,
      type: 'SUBSCRIPTION',
      amountKobo: priceKobo,
      subtotalKobo: priceKobo,
      vatKobo: 0,
      discountKobo: 0,
      dueAt: new Date(now.getTime() + 14 * 86400000),
      issuedAt: now,
      lineDescription,
    });

    const reference = 'PAY-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    const payment = await this.prisma.payment.create({
      data: { invoiceId: invoice.id, provider: 'PAYSTACK', amountKobo: priceKobo, reference, status: 'PENDING' },
    });

    try {
      const result = await this.paystack.initializeTransaction({
        email: body.email ?? subscriber.user?.email ?? '',
        amountKobo: priceKobo,
        reference,
        callbackUrl,
        metadata: { action, planId, months, invoiceId: invoice.id, paymentId: payment.id },
      });
      await this.prisma.paymentAttempt.create({
        data: {
          paymentId: payment.id,
          provider: 'PAYSTACK',
          reference,
          status: 'PENDING',
          response: { action: 'initialize', meta: { action, planId, months } },
        },
      });
      return { authorizationUrl: result.authorizationUrl, reference, amountKobo: priceKobo, months, paymentId: payment.id, invoiceId: invoice.id };
    } catch (err: any) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
      throw new BadRequestException(`Payment initialization failed: ${err.message}`);
    }
  }

  /**
   * Completes a customer self-service payment. Idempotent — safe to call from
   * both the Paystack webhook and the browser redirect verify endpoint.
   */
  async completeCustomerPayment(paymentId: string, opts: { action: string; planId?: string; reference: string; months?: number }) {
    const months = this.normalizeMonths(opts.months);
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { invoice: true },
    });

    // Claim the payment (PENDING → SUCCESSFUL). Only the first caller wins;
    // a concurrent webhook + verify redirect can't apply the action twice.
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'SUCCESSFUL' },
    });
    if (claimed.count === 0) {
      this.logger.log(`Customer payment already completed elsewhere: ${payment.id}`);
      return;
    }

    const { action, planId, reference } = opts;
    const now = new Date();
    const subscriberId = payment.invoice.subscriberId;

    const existingSub = await this.prisma.subscription.findFirst({
      where: { subscriberId },
      include: { plan: true },
      orderBy: { startedAt: 'desc' },
    });

    if (action === 'renew' && existingSub) {
      await this.prisma.subscription.update({
        where: { id: existingSub.id },
        data: {
          expiresAt: this.addMonths(new Date(Math.max((existingSub.expiresAt ?? now).getTime(), now.getTime())), months),
          suspendedAt: null,
        },
      });
    } else if (action === 'change_plan' && planId && existingSub) {
      await this.prisma.subscription.update({
        where: { id: existingSub.id },
        data: { planId, startedAt: now, expiresAt: this.addMonths(now, months), suspendedAt: null },
      });
    } else if (action === 'add_plan' && planId) {
      await this.prisma.subscription.create({
        data: { subscriberId, planId, expiresAt: this.addMonths(now, months), autoRenew: true },
      });
    }

    // markPaid upserts the payment row (by reference) and creates the receipt + PAID status
    await this.billing.markPaid(payment.invoiceId, { provider: 'PAYSTACK', reference, amountKobo: payment.amountKobo });

    await this.notifyRadiusActivation(payment.invoiceId);

    let planName: string | undefined;
    if (action === 'renew') {
      planName = existingSub?.plan?.name;
    } else if (planId) {
      const planRow = await this.prisma.plan.findUnique({ where: { id: planId } });
      planName = planRow?.name;
    }
    await this.sendPaymentEmails(payment.id, reference, 'success', { action, planName });

    this.logger.log(`Customer payment completed via Paystack: ref=${reference}`);
  }

  async finalizeCustomerPayment(reference: string) {
    const payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'SUCCESSFUL') return { status: 'SUCCESSFUL', reference };

    const verified = await this.paystack.verifyTransaction(reference);
    if (verified.status === 'failed') {
      this.logger.warn(`Paystack verification for ${reference} returned 'failed'`);
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } }).catch(() => {});
      return { status: 'FAILED', reference };
    }
    if (verified.status !== 'success') {
      // 'abandoned'/pending/unknown — leave the payment PENDING so a webhook
      // or later verify can still complete it. Do not mark FAILED on
      // transient/ambiguous states.
      this.logger.warn(`Paystack verification for ${reference} inconclusive ('${verified.status}') — leaving payment pending`);
      return { status: verified.status.toUpperCase(), reference };
    }

    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: { paymentId: payment.id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    const meta = (attempt?.response as any)?.meta ?? {};
    await this.completeCustomerPayment(payment.id, {
      action: meta.action ?? 'renew',
      planId: meta.planId,
      months: meta.months,
      reference,
    });
    return { status: 'SUCCESSFUL', reference };
  }

  private async sendPaymentEmails(paymentId: string, reference: string, outcome: 'success' | 'failed', opts?: { action?: string; planName?: string }) {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
          invoice: {
            include: { subscriber: { include: { user: { select: { email: true, name: true } } } } },
          },
        },
      });
      const email = payment?.invoice?.subscriber?.user?.email;
      if (!email) {
        this.logger.warn(`Payment email skipped — no subscriber email for payment ${paymentId}`);
        return;
      }
      const name = payment.invoice.subscriber.user.name || 'Customer';
      let { action, planName } = opts ?? {};
      if (!planName) {
        const sub = await this.prisma.subscription.findFirst({
          where: { subscriberId: payment.invoice.subscriberId },
          include: { plan: true },
          orderBy: { startedAt: 'desc' },
        });
        planName = sub?.plan?.name;
      }
      if (outcome === 'success') {
        this.mail.enqueue(() => this.mail.sendPaymentReceipt({
          email,
          customerName: name,
          invoiceNumber: payment.invoice.invoiceNumber,
          amountKobo: payment.amountKobo,
          reference,
          action: (action as any) ?? 'renew',
          planName,
        }));
      } else {
        this.mail.enqueue(() => this.mail.sendPaymentFailed({
          email,
          customerName: name,
          invoiceNumber: payment.invoice.invoiceNumber,
          amountKobo: payment.amountKobo,
          reference,
        }));
      }
    } catch (err: any) {
      this.logger.error(`Payment email failed: ${err?.message}`);
    }
  }

  // ── Record Offline / Manual Payment ────────────────────────

  async recordOfflinePayment(data: {
    invoiceId: string;
    amountKobo: number;
    provider: string;
    reference: string;
    providerReference?: string;
  }) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: data.invoiceId } });
    if (invoice.status === 'PAID') throw new BadRequestException('Invoice already paid');

    const result = await this.billing.markPaid(data.invoiceId, {
      provider: data.provider,
      reference: data.reference,
      amountKobo: data.amountKobo,
    });
    await this.audit.log({ action: 'OFFLINE_PAYMENT_RECORDED', entityType: 'Invoice', entityId: data.invoiceId, metadata: { invoiceId: data.invoiceId, amountKobo: data.amountKobo, provider: data.provider } });
    await this.notifyRadiusActivation(data.invoiceId);
    return result;
  }

  // ── Partial Payment ────────────────────────────────────────

  async recordPartialPayment(data: {
    invoiceId: string;
    amountKobo: number;
    provider: string;
    reference: string;
  }) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: data.invoiceId } });
    if (invoice.status === 'PAID') throw new BadRequestException('Invoice already paid');

    const totalPaidSoFar = await this.prisma.payment.aggregate({
      where: { invoiceId: data.invoiceId, status: 'SUCCESSFUL' },
      _sum: { amountKobo: true },
    });
    const paidKobo = (totalPaidSoFar._sum.amountKobo ?? 0) + data.amountKobo;

    const payment = await this.prisma.payment.create({
      data: {
        invoiceId: data.invoiceId,
        provider: data.provider as any,
        amountKobo: data.amountKobo,
        reference: data.reference,
        status: 'SUCCESSFUL',
        paidAt: new Date(),
      },
    });
    await this.audit.log({ action: 'PARTIAL_PAYMENT_RECORDED', entityType: 'Payment', entityId: payment.id, metadata: { invoiceId: data.invoiceId, amountKobo: data.amountKobo } });

    if (paidKobo >= invoice.amountKobo) {
      await this.billing.markPaid(data.invoiceId);
      await this.notifyRadiusActivation(data.invoiceId);
    }

    return { paidKobo, remainingKobo: Math.max(0, invoice.amountKobo - paidKobo), fullyPaid: paidKobo >= invoice.amountKobo };
  }

  // ── Wallet ─────────────────────────────────────────────────

  async getWallet(subscriberId: string) {
    let wallet = await this.prisma.wallet.findUnique({ where: { subscriberId } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { subscriberId, balanceKobo: 0 },
      });
    }
    return wallet;
  }

  async getWalletTransactions(subscriberId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { subscriberId } });
    if (!wallet) return [];
    return this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async creditWallet(subscriberId: string, amountKobo: number, reference: string, description?: string) {
    const wallet = await this.getWallet(subscriberId);
    return this.prisma.$transaction(async tx => {
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceKobo: { increment: amountKobo } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'CREDIT',
          amountKobo,
          balanceKobo: updated.balanceKobo,
          reference,
          description,
        },
      });
      return updated;
    });
  }

  async debitWallet(subscriberId: string, amountKobo: number, reference: string, description?: string, invoiceId?: string) {
    return this.prisma.$transaction(async tx => {
      // Atomic conditional decrement — prevents a TOCTOU double-spend where
      // two concurrent debits both pass a pre-transaction balance check.
      const updated = await tx.wallet.updateMany({
        where: { subscriberId, balanceKobo: { gte: amountKobo } },
        data: { balanceKobo: { decrement: amountKobo } },
      });
      if (updated.count === 0) throw new BadRequestException('Insufficient wallet balance');
      const wallet = await tx.wallet.findFirstOrThrow({ where: { subscriberId } });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'DEBIT',
          amountKobo,
          balanceKobo: wallet.balanceKobo,
          reference,
          description,
          invoiceId,
        },
      });
      return wallet;
    });
  }

  async payWithWallet(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (invoice.status === 'PAID') throw new BadRequestException('Invoice already paid');

    const subscriberId = invoice.subscriberId;
    const wallet = await this.getWallet(subscriberId);
    if (wallet.balanceKobo < invoice.amountKobo) throw new BadRequestException('Insufficient wallet balance');

    const reference = `WAL-${Date.now()}`;

    try {
      await this.debitWallet(subscriberId, invoice.amountKobo, reference, `Payment for ${invoice.invoiceNumber}`, invoiceId);

      await this.prisma.payment.create({
        data: {
          invoiceId,
          provider: 'BANK_TRANSFER',
          amountKobo: invoice.amountKobo,
          reference,
          status: 'SUCCESSFUL',
          paidAt: new Date(),
        },
      });

      await this.billing.markPaid(invoiceId);
      await this.notifyRadiusActivation(invoiceId);
    } catch (err) {
      // Don't leave the wallet debited if anything after the debit failed.
      await this.creditWallet(
        subscriberId,
        invoice.amountKobo,
        `REF-${reference}`,
        `Refund — failed to mark ${invoice.invoiceNumber} paid`,
      ).catch(() => {});
      throw err;
    }

    return { message: 'Invoice paid from wallet', invoiceNumber: invoice.invoiceNumber };
  }

  // ── Virtual Accounts ───────────────────────────────────────

  async getVirtualAccounts(subscriberId: string) {
    return this.prisma.virtualAccount.findMany({ where: { subscriberId, isActive: true } });
  }

  /**
   * Disabled — this previously FABRICATED local bank account numbers that were
   * never provisioned with any bank. Customers could transfer real money to
   * accounts that don't exist. Re-introduce only behind a real provider
   * integration (e.g. Paystack Dedicated Virtual Accounts / Wema API).
   */
  async assignVirtualAccount(subscriberId: string): Promise<never> {
    throw new BadRequestException(
      'Virtual account issuance is not available — no bank provider is integrated',
    );
  }

  // ── Refunds ────────────────────────────────────────────────

  private async nextRefundNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const last = await this.prisma.refund.findFirst({
      where: { refundNumber: { startsWith: `RFN-${year}` } },
      orderBy: { createdAt: 'desc' },
    });
    const seq = last ? parseInt(last.refundNumber.split('-').pop()!, 10) + 1 : 1;
    return `RFN-${year}-${String(seq).padStart(6, '0')}`;
  }

  async listRefunds(filters?: { status?: string }) {
    const where: any = {};
    if (filters?.status) where.status = filters.status;
    return this.prisma.refund.findMany({
      where,
      include: { payment: { select: { reference: true, amountKobo: true, invoice: { select: { invoiceNumber: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async requestRefund(data: { paymentId: string; amountKobo: number; reason?: string }) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: data.paymentId } });
    if (payment.status !== 'SUCCESSFUL') throw new BadRequestException('Can only refund successful payments');

    // Retry with a fresh sequence number when concurrent requests collide on
    // the unique refundNumber.
    let lastErr: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const refundNumber = await this.nextRefundNumber();
        return await this.prisma.refund.create({
          data: {
            refundNumber,
            paymentId: data.paymentId,
            invoiceId: payment.invoiceId,
            amountKobo: data.amountKobo,
            reason: data.reason,
            status: 'PENDING',
          },
        });
      } catch (e: any) {
        lastErr = e;
        if (e?.code === 'P2002' && String(e?.meta?.target ?? '').includes('refundNumber')) continue;
        throw e;
      }
    }
    throw lastErr;
  }

  async approveRefund(id: string, approvedById: string) {
    const existing = await this.prisma.refund.findUniqueOrThrow({ where: { id } });
    if (existing.status !== 'PENDING') throw new BadRequestException('Refund is not pending');

    const updated = await this.prisma.refund.update({
      where: { id },
      data: { status: 'APPROVED', approvedById, approvedAt: new Date() },
    });
    await this.audit.log({ action: 'REFUND_APPROVED', entityType: 'Refund', entityId: id, metadata: { approvedById } });
    return updated;
  }

  async processRefund(id: string) {
    const refund = await this.prisma.refund.findUniqueOrThrow({ where: { id } });
    if (refund.status !== 'APPROVED') throw new BadRequestException('Refund must be approved first');

    return this.prisma.$transaction(async tx => {
      await tx.refund.update({
        where: { id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      await tx.payment.update({
        where: { id: refund.paymentId },
        data: { status: 'REFUNDED' },
      });
      await tx.invoice.update({
        where: { id: refund.invoiceId },
        data: { status: 'VOID' },
      });
      await this.audit.log({ action: 'REFUND_PROCESSED', entityType: 'Refund', entityId: id });
      return { message: 'Refund processed', refundId: id };
    });
  }

  async rejectRefund(id: string, reason?: string) {
    const refund = await this.prisma.refund.update({
      where: { id },
      data: { status: 'REJECTED', reason: reason ?? undefined },
    });
    await this.audit.log({ action: 'REFUND_REJECTED', entityType: 'Refund', entityId: id, metadata: { reason } });
    return refund;
  }

  // ── Webhook ────────────────────────────────────────────────

  async handlePaystackWebhook(rawBody: Buffer, signature: string) {
    let body: any;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      this.logger.warn('Paystack webhook payload is not valid JSON');
      return;
    }

    // Resolve the tenant's key from the payment reference; fall back to env.
    const reference = body?.data?.reference;
    const secret = reference
      ? await this.gatewayKeys.getPaystackSecretForReference(reference)
      : (process.env.PAYSTACK_SECRET_KEY ?? '');
    if (!secret) {
      this.logger.error('Paystack webhook rejected — no Paystack secret key configured');
      return;
    }
    const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    const expected = Buffer.from(hash, 'utf8');
    const received = Buffer.from(String(signature ?? ''), 'utf8');
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      this.logger.warn('Paystack webhook signature mismatch');
      return;
    }

    const { event, data } = body;
    if (event === 'charge.success') {
      const reference = data.reference;
      const payment = await this.prisma.payment.findUnique({ where: { reference } });
      if (!payment) {
        this.logger.warn(`Paystack webhook for unknown reference: ${reference}`);
        return;
      }
      if (payment.status === 'SUCCESSFUL') {
        this.logger.log(`Paystack webhook re-delivery ignored (already processed): ${reference}`);
        return;
      }

      await this.prisma.paymentAttempt.create({
        data: { paymentId: payment.id, provider: 'PAYSTACK', reference, status: 'SUCCESSFUL', response: { webhook: body } },
      });

      // Customer self-service checkout → complete the full flow (subscription + receipt).
      const initAttempt = await this.prisma.paymentAttempt.findFirst({
        where: { paymentId: payment.id, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
      const meta = (initAttempt?.response as any)?.meta;
      if (meta?.action) {
        await this.completeCustomerPayment(payment.id, { action: meta.action, planId: meta.planId, months: meta.months, reference });
        return;
      }

      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCESSFUL', paidAt: new Date(), providerReference: data.id?.toString() },
      });

      await this.billing.markPaid(payment.invoiceId, {
        provider: 'PAYSTACK',
        reference,
        amountKobo: payment.amountKobo,
      });
      await this.notifyRadiusActivation(payment.invoiceId);
      await this.sendPaymentEmails(payment.id, reference, 'success');

      this.logger.log(`Invoice ${payment.invoiceId} marked PAID via Paystack ${reference}`);
    } else if (event === 'charge.failed') {
      const reference = data.reference;
      const payment = await this.prisma.payment.findUnique({ where: { reference } });
      if (!payment) {
        this.logger.warn(`Paystack failed-webhook for unknown reference: ${reference}`);
        return;
      }
      await this.prisma.paymentAttempt.create({
        data: { paymentId: payment.id, provider: 'PAYSTACK', reference, status: 'FAILED', response: { webhook: body } },
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      }).catch(() => {});
      await this.sendPaymentEmails(payment.id, reference, 'failed');
      this.logger.warn(`Paystack payment FAILED: ${reference}`);
    }
  }

  async handleGenericWebhook(payload: { reference: string; status: string; provider: string; providerReference?: string }) {
    const payment = await this.prisma.payment.findUnique({ where: { reference: payload.reference } });
    if (!payment) {
      this.logger.warn(`Webhook for unknown payment reference: ${payload.reference}`);
      return;
    }

    await this.prisma.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        provider: payload.provider,
        reference: payload.reference,
        status: payload.status,
        response: { webhook: payload },
      },
    });

    if (payload.status === 'SUCCESSFUL') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCESSFUL', paidAt: new Date(), providerReference: payload.providerReference },
      });
      await this.billing.markPaid(payment.invoiceId, {
        provider: payload.provider,
        reference: payload.reference,
        amountKobo: payment.amountKobo,
      });
      await this.notifyRadiusActivation(payment.invoiceId);
    } else if (payload.status === 'FAILED') {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    }
  }

  // ── Invoice/Receipt sequence helpers ──────────────────────

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

  /**
   * Creates the checkout invoice, retrying with a fresh sequence number when
   * concurrent creators collide on the unique invoiceNumber.
   */
  private async createInvoiceWithUniqueNumber(data: {
    subscriberId: string;
    type: 'SUBSCRIPTION';
    amountKobo: number;
    subtotalKobo: number;
    vatKobo: number;
    discountKobo: number;
    dueAt: Date;
    issuedAt: Date;
    lineDescription: string;
  }) {
    let lastErr: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const invNum = 'INV-' + new Date().getFullYear() + '-' + String(await this.nextInvoiceSeq() + attempt).padStart(6, '0');
        return await this.prisma.invoice.create({
          data: {
            invoiceNumber: invNum,
            subscriberId: data.subscriberId,
            type: data.type,
            status: 'ISSUED',
            amountKobo: data.amountKobo,
            subtotalKobo: data.subtotalKobo,
            vatKobo: data.vatKobo,
            discountKobo: data.discountKobo,
            dueAt: data.dueAt,
            issuedAt: data.issuedAt,
            lines: {
              create: {
                description: data.lineDescription,
                amountKobo: data.amountKobo,
                quantity: 1,
              },
            },
          },
        });
      } catch (e: any) {
        lastErr = e;
        if (e?.code === 'P2002' && String(e?.meta?.target ?? '').includes('invoiceNumber')) continue;
        throw e;
      }
    }
    throw lastErr;
  }

  // ── Reconciliation ─────────────────────────────────────────

  async getReconciliations() {
    return this.prisma.paymentReconciliation.findMany({ orderBy: { referenceDate: 'desc' }, take: 30 });
  }

  async createReconciliation(data: {
    referenceDate: Date;
    gatewayAmountKobo: number;
    bankAmountKobo?: number;
    invoiceAmountKobo?: number;
    notes?: string;
  }) {
    const bankAmount = data.bankAmountKobo ?? 0;
    const invoiceAmount = data.invoiceAmountKobo ?? 0;
    const varianceKobo = data.gatewayAmountKobo - bankAmount;
    const status = varianceKobo === 0 ? 'MATCHED' : 'DISCREPANCY';

    return this.prisma.paymentReconciliation.create({
      data: {
        referenceDate: data.referenceDate,
        gatewayAmountKobo: data.gatewayAmountKobo,
        bankAmountKobo: bankAmount,
        invoiceAmountKobo: invoiceAmount,
        varianceKobo,
        status,
        notes: data.notes,
      },
    });
  }

  // ── Create Payment (direct) ────────────────────────────────

  async create(data: { invoiceId: string; provider: string; amountKobo: number; reference: string; status?: string }) {
    const payment = await this.prisma.payment.create({
      data: {
        invoiceId: data.invoiceId,
        provider: data.provider as any,
        amountKobo: data.amountKobo,
        reference: data.reference,
        status: (data.status as any) ?? 'PENDING',
      },
    });
    await this.audit.log({ action: 'PAYMENT_CREATED', entityType: 'Payment', entityId: payment.id, metadata: { invoiceId: data.invoiceId, amountKobo: data.amountKobo, provider: data.provider } });
    return payment;
  }
}
