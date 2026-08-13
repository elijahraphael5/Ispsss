import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../audit-logs/audit.service';
import { PaystackProvider } from './providers/paystack.provider';
import * as crypto from 'crypto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
    private readonly paystack: PaystackProvider,
  ) {}

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
    const wallet = await this.getWallet(subscriberId);
    if (wallet.balanceKobo < amountKobo) throw new BadRequestException('Insufficient wallet balance');

    return this.prisma.$transaction(async tx => {
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceKobo: { decrement: amountKobo } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'DEBIT',
          amountKobo,
          balanceKobo: updated.balanceKobo,
          reference,
          description,
          invoiceId,
        },
      });
      return updated;
    });
  }

  async payWithWallet(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (invoice.status === 'PAID') throw new BadRequestException('Invoice already paid');

    const subscriberId = invoice.subscriberId;
    const wallet = await this.getWallet(subscriberId);
    if (wallet.balanceKobo < invoice.amountKobo) throw new BadRequestException('Insufficient wallet balance');

    const reference = `WAL-${Date.now()}`;

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

    return { message: 'Invoice paid from wallet', invoiceNumber: invoice.invoiceNumber };
  }

  // ── Virtual Accounts ───────────────────────────────────────

  async getVirtualAccounts(subscriberId: string) {
    return this.prisma.virtualAccount.findMany({ where: { subscriberId, isActive: true } });
  }

  async assignVirtualAccount(subscriberId: string) {
    const existing = await this.prisma.virtualAccount.findFirst({ where: { subscriberId, isActive: true } });
    if (existing) return existing;

    const banks = [
      { bank: 'Wema Bank', prefix: '5310' },
      { bank: 'Providus Bank', prefix: '7890' },
      { bank: 'Sterling Bank', prefix: '1122' },
    ];

    const count = await this.prisma.virtualAccount.count();
    const bank = banks[count % banks.length];
    const accountNumber = `${bank.prefix}${String(100000 + count).slice(0, 6)}`;

    const subscriber = await this.prisma.subscriber.findUnique({
      where: { id: subscriberId },
      include: { user: { select: { email: true } } },
    });

    return this.prisma.virtualAccount.create({
      data: {
        subscriberId,
        bankName: bank.bank,
        accountNumber,
        accountName: `Hikonnect - ${subscriber?.user?.email?.split('@')[0] ?? 'Customer'}`,
        provider: 'BANK_TRANSFER',
      },
    });
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

    const refundNumber = await this.nextRefundNumber();
    return this.prisma.refund.create({
      data: {
        refundNumber,
        paymentId: data.paymentId,
        invoiceId: payment.invoiceId,
        amountKobo: data.amountKobo,
        reason: data.reason,
        status: 'PENDING',
      },
    });
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

  async handlePaystackWebhook(body: any, signature: string) {
    const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY ?? '').update(JSON.stringify(body)).digest('hex');
    if (hash !== signature) {
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

      await this.prisma.paymentAttempt.create({
        data: { paymentId: payment.id, provider: 'PAYSTACK', reference, status: 'SUCCESSFUL', response: { webhook: body } },
      });

      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCESSFUL', paidAt: new Date(), providerReference: data.id?.toString() },
      });

      await this.billing.markPaid(payment.invoiceId, {
        provider: 'PAYSTACK',
        reference,
        amountKobo: payment.amountKobo,
      });

      this.logger.log(`Invoice ${payment.invoiceId} marked PAID via Paystack ${reference}`);
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
    } else if (payload.status === 'FAILED') {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    }
  }

  // ── Paysorta Webhook ───────────────────────────────────────

  async handlePaysortaWebhook(payload: any) {
    const { reference, status, metadata } = payload;
    const ref = reference || payload.paymentCode || payload.transaction;
    if (!ref) throw new BadRequestException('Missing reference');

    this.logger.log(`Paysorta webhook: ref=${ref} status=${status}`);

    // Check if already processed
    const existing = await this.prisma.payment.findUnique({ where: { reference: ref } });
    if (existing) {
      this.logger.log(`Payment ${ref} already exists (${existing.status})`);
      return existing;
    }

    // Parse metadata (JSON string or object)
    let meta: any = {};
    if (typeof metadata === 'string') { try { meta = JSON.parse(metadata); } catch {} }
    else if (metadata) meta = metadata;

    const action = meta.action || 'renew';
    const planId = meta.planId;
    let subscriberId = meta.subscriberId;
    let userId = meta.userId;

    // Resolve subscriber from userId if needed
    if (!subscriberId && userId) {
      const sub = await this.prisma.subscriber.findFirst({ where: { userId, deletedAt: null } });
      if (sub) subscriberId = sub.id;
    }

    if (!subscriberId) {
      this.logger.warn(`Paysorta webhook: no subscriberId for ref=${ref}`);
      return { status: 'ignored', reason: 'no subscriber' };
    }

    if (status === 'success' || status === 'SUCCESSFUL') {
      const now = new Date();
      let plan: any = null;
      let subscriptionId: string | null = null;
      let priceKobo = 100000; // default ₦1000

      // Resolve plan and amount
      if (planId) {
        plan = await this.prisma.plan.findUnique({ where: { id: planId } });
        if (plan) priceKobo = 100000; // fixed ₦1000 for now
      }
      if (!plan && action !== 'renew') {
        const existing = await this.prisma.subscription.findFirst({
          where: { subscriberId },
          include: { plan: true },
        });
        if (existing) plan = existing.plan;
      }
      if (!plan) {
        plan = await this.prisma.plan.findFirst({ where: { isActive: true } });
      }
      const planName = plan?.name ?? 'Hikonnect Plan';
      priceKobo = 100000;

      // Get or create subscription for renew/change
      const existingSub = await this.prisma.subscription.findFirst({
        where: { subscriberId },
        include: { plan: true },
        orderBy: { startedAt: 'desc' },
      });

      if (action === 'renew' && existingSub) {
        subscriptionId = existingSub.id;
        const expiresAt = new Date(Math.max(existingSub.expiresAt.getTime(), now.getTime()) + 30 * 86400000);
        await this.prisma.subscription.update({
          where: { id: existingSub.id },
          data: { expiresAt, suspendedAt: null },
        });
      } else if ((action === 'change_plan' || action === 'add_plan') && planId) {
        if (existingSub && action === 'change_plan') {
          subscriptionId = existingSub.id;
          const expiresAt = new Date(now.getTime() + 30 * 86400000);
          await this.prisma.subscription.update({
            where: { id: existingSub.id },
            data: { planId, startedAt: now, expiresAt, suspendedAt: null },
          });
        } else {
          const expiresAt = new Date(now.getTime() + 30 * 86400000);
          const created = await this.prisma.subscription.create({
            data: { subscriberId, planId, expiresAt, autoRenew: true },
          });
          subscriptionId = created.id;
        }
      }

      // Create Invoice
      const invNum = 'INV-' + now.getFullYear() + '-' + String(await this.nextInvoiceSeq()).padStart(6, '0');
      const dueAt = new Date(now.getTime() + 14 * 86400000);
      const totalKobo = priceKobo;

      const invoice = await this.prisma.invoice.create({
        data: {
          invoiceNumber: invNum,
          subscriberId,
          type: 'SUBSCRIPTION',
          status: 'PAID',
          amountKobo: totalKobo,
          subtotalKobo: priceKobo,
          vatKobo: 0,
          discountKobo: 0,
          dueAt,
          issuedAt: now,
          paidAt: now,
          lines: {
            create: {
              description: action === 'change_plan' ? 'Plan Change: ' + planName
                : action === 'renew' ? 'Renewal: ' + planName
                : 'New Plan: ' + planName,
              amountKobo: priceKobo,
              quantity: 1,
            },
          },
        },
      });

      // Create Payment
      const payment = await this.prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amountKobo: totalKobo,
          status: 'SUCCESSFUL',
          provider: 'PAYSORTA',
          reference: ref,
          paidAt: now,
        },
      });

      // Create Receipt
      await this.prisma.receipt.create({
        data: {
          invoiceId: invoice.id,
          receiptNumber: 'RCT-' + now.getFullYear() + '-' + String(await this.nextReceiptSeq()).padStart(6, '0'),
          amountKobo: totalKobo,
          paymentMethod: 'PAYSORTA',
          transactionRef: ref,
          paidAt: now,
        },
      });

      this.logger.log(`Paysorta payment processed: ref=${ref} invoice=${invNum}`);
      return { status: 'SUCCESSFUL', invoiceId: invoice.id, paymentId: payment.id };
    } else {
      // Failed payment - record attempt
      await this.prisma.paymentAttempt.create({
        data: {
          paymentId: '',
          provider: 'PAYSORTA',
          reference: ref,
          status: 'FAILED',
          response: { webhook: payload },
        },
      }).catch(() => {});
      this.logger.warn(`Paysorta payment failed: ref=${ref}`);
      return { status: 'FAILED', reference: ref };
    }
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
