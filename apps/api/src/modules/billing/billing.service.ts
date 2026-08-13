import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-logs/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoiceStatus, InvoiceType } from '@prisma/client';

const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ['ISSUED', 'VOID'],
  ISSUED: ['OVERDUE', 'VOID', 'PAID'],
  PAID: [],
  OVERDUE: ['PAID', 'VOID'],
  VOID: [],
};

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async nextInvoiceNumber(type: InvoiceType): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = type === 'INSTALLATION' ? 'INV-INS' : type === 'ONE_TIME' ? 'INV-OTS' : type === 'MANUAL' ? 'INV-MAN' : 'INV';
    const last = await this.prisma.invoice.findFirst({
      where: { invoiceNumber: { startsWith: `${prefix}-${year}` } },
      orderBy: { createdAt: 'desc' },
    });
    const seq = last ? parseInt(last.invoiceNumber.split('-').pop()!, 10) + 1 : 1;
    return `${prefix}-${year}-${String(seq).padStart(6, '0')}`;
  }

  private async nextQuotationNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const last = await this.prisma.quotation.findFirst({
      where: { quotationNumber: { startsWith: `QTN-${year}` } },
      orderBy: { createdAt: 'desc' },
    });
    const seq = last ? parseInt(last.quotationNumber.split('-').pop()!, 10) + 1 : 1;
    return `QTN-${year}-${String(seq).padStart(6, '0')}`;
  }

  private async nextReceiptNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const last = await this.prisma.receipt.findFirst({
      where: { receiptNumber: { startsWith: `RCT-${year}` } },
      orderBy: { createdAt: 'desc' },
    });
    const seq = last ? parseInt(last.receiptNumber.split('-').pop()!, 10) + 1 : 1;
    return `RCT-${year}-${String(seq).padStart(6, '0')}`;
  }

  // ── Dashboard ──────────────────────────────────────────────

  async getDashboard() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const [revenueToday, revenueMonth, revenueYear, invoices, totals] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESSFUL', paidAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
        _sum: { amountKobo: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESSFUL', paidAt: { gte: startOfMonth } },
        _sum: { amountKobo: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESSFUL', paidAt: { gte: startOfYear } },
        _sum: { amountKobo: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['status'],
        _count: { id: true },
        _sum: { amountKobo: true },
      }),
      this.prisma.invoice.aggregate({
        _sum: { amountKobo: true },
        where: { status: { not: 'VOID' } },
      }),
    ]);

    const statusMap: Record<string, { count: number; amount: number }> = {};
    for (const row of invoices) {
      statusMap[row.status] = {
        count: row._count.id,
        amount: row._sum.amountKobo ?? 0,
      };
    }

    const totalOutstanding = (totals._sum.amountKobo ?? 0)
      - (statusMap.PAID?.amount ?? 0);

    return {
      revenueToday: revenueToday._sum.amountKobo ?? 0,
      revenueThisMonth: revenueMonth._sum.amountKobo ?? 0,
      revenueThisYear: revenueYear._sum.amountKobo ?? 0,
      invoices: {
        generated: (statusMap.DRAFT?.count ?? 0) + (statusMap.ISSUED?.count ?? 0),
        paid: statusMap.PAID?.count ?? 0,
        pending: statusMap.ISSUED?.count ?? 0,
        overdue: statusMap.OVERDUE?.count ?? 0,
        void: statusMap.VOID?.count ?? 0,
      },
      collections: {
        totalOutstanding,
        collectionRate: totals._sum.amountKobo
          ? Math.round(((statusMap.PAID?.amount ?? 0) / totals._sum.amountKobo) * 100)
          : 0,
      },
    };
  }

  // ── Invoices ───────────────────────────────────────────────

  async findAll(filters?: { status?: string; type?: string; search?: string }) {
    const where: any = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.type) where.type = filters.type;
    if (filters?.search) {
      where.OR = [
        { invoiceNumber: { contains: filters.search, mode: 'insensitive' } },
        { subscriber: { user: { email: { contains: filters.search, mode: 'insensitive' } } } },
      ];
    }
    return this.prisma.invoice.findMany({
      where,
      include: {
        lines: true,
        payments: { where: { status: 'SUCCESSFUL' } },
        subscriber: {
          select: { id: true, user: { select: { id: true, email: true, phone: true } } },
        },
        _count: { select: { payments: true, receipts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        lines: true,
        payments: true,
        receipts: true,
        creditNotes: true,
        subscriber: {
          select: { id: true, user: { select: { id: true, email: true, phone: true } }, type: true },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async create(data: {
    subscriberId: string;
    type: InvoiceType;
    dueAt: Date;
    lines: { description: string; amountKobo: number; quantity?: number }[];
    vatKobo?: number;
    discountKobo?: number;
    notes?: string;
  }, actorId: string) {
    const subtotalKobo = data.lines.reduce((s, l) => s + l.amountKobo * (l.quantity ?? 1), 0);
    const discountKobo = data.discountKobo ?? 0;
    const vatKobo = data.vatKobo ?? Math.round((subtotalKobo - discountKobo) * 0.075);
    const amountKobo = subtotalKobo - discountKobo + vatKobo;
    const invoiceNumber = await this.nextInvoiceNumber(data.type);

    const result = await this.prisma.invoice.create({
      data: {
        invoiceNumber,
        subscriberId: data.subscriberId,
        type: data.type,
        status: 'DRAFT',
        amountKobo,
        subtotalKobo,
        vatKobo,
        discountKobo,
        dueAt: data.dueAt,
        notes: data.notes,
        lines: { createMany: { data: data.lines.map(l => ({ description: l.description, amountKobo: l.amountKobo, quantity: l.quantity ?? 1 })) } },
      },
      include: { lines: true, subscriber: { select: { id: true, user: { select: { id: true, email: true } } } } },
    });
    await this.audit.log({ actorId, action: 'INVOICE_CREATED', entityType: 'Invoice', entityId: result.id, metadata: { invoiceNumber, amountKobo, type: data.type, lineCount: data.lines.length } });
    return result;
  }

  async issue(id: string, actorId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id } });
    this.assertTransition(invoice.status, 'ISSUED');
    const result = await this.prisma.invoice.update({
      where: { id },
      data: { status: 'ISSUED', issuedAt: new Date() },
      include: { lines: true, subscriber: { select: { id: true, user: { select: { id: true, email: true } } } } },
    });
    await this.audit.log({ actorId, action: 'INVOICE_ISSUED', entityType: 'Invoice', entityId: id, metadata: { fromStatus: invoice.status, invoiceNumber: invoice.invoiceNumber, amountKobo: invoice.amountKobo } });
    return result;
  }

  async voidInvoice(id: string, actorId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id } });
    this.assertTransition(invoice.status, 'VOID');
    const result = await this.prisma.invoice.update({
      where: { id },
      data: { status: 'VOID' },
    });
    await this.audit.log({ actorId, action: 'INVOICE_VOIDED', entityType: 'Invoice', entityId: id, metadata: { fromStatus: invoice.status, invoiceNumber: invoice.invoiceNumber, amountKobo: invoice.amountKobo } });
    return result;
  }

  async markPaid(id: string, paymentData?: { provider: string; reference: string; amountKobo: number }, actorId?: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id },
      include: { payments: true },
    });
    this.assertTransition(invoice.status, 'PAID');

    if (paymentData) {
      const receiptNumber = await this.nextReceiptNumber();
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            invoiceId: id,
            provider: paymentData.provider as any,
            reference: paymentData.reference,
            amountKobo: paymentData.amountKobo,
            status: 'SUCCESSFUL',
            paidAt: new Date(),
          },
        });
        await tx.receipt.create({
          data: {
            receiptNumber,
            invoiceId: id,
            amountKobo: paymentData.amountKobo,
            paymentMethod: paymentData.provider,
            transactionRef: paymentData.reference,
            paidAt: new Date(),
          },
        });
        await tx.invoice.update({
          where: { id },
          data: { status: 'PAID', paidAt: new Date() },
        });
      });
    } else {
      const result = await this.prisma.invoice.update({
        where: { id },
        data: { status: 'PAID', paidAt: new Date() },
      });
      await this.audit.log({ actorId: actorId ?? 'SYSTEM', action: 'INVOICE_PAID', entityType: 'Invoice', entityId: id, metadata: { fromStatus: invoice.status, invoiceNumber: invoice.invoiceNumber, amountKobo: invoice.amountKobo } });
      return result;
    }

    const result = await this.prisma.invoice.findUnique({
      where: { id },
      include: { lines: true, payments: true, receipts: true },
    });
    await this.audit.log({ actorId: actorId ?? 'SYSTEM', action: 'INVOICE_PAID', entityType: 'Invoice', entityId: id, metadata: { fromStatus: invoice.status, invoiceNumber: invoice.invoiceNumber, amountKobo: invoice.amountKobo, provider: paymentData.provider, reference: paymentData.reference } });
    return result;
  }

  async markOverdue(id: string, actorId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id }, include: { subscriber: { select: { id: true, userId: true } } } });
    this.assertTransition(invoice.status, 'OVERDUE');
    const result = await this.prisma.invoice.update({
      where: { id },
      data: { status: 'OVERDUE' },
    });
    await this.audit.log({ actorId, action: 'INVOICE_OVERDUE', entityType: 'Invoice', entityId: id, metadata: { fromStatus: invoice.status, invoiceNumber: invoice.invoiceNumber, amountKobo: invoice.amountKobo } });
    await this.notifications.create({ title: 'Invoice Overdue', message: `Invoice ${invoice.invoiceNumber} for ${invoice.subscriber?.id ?? '—'} is overdue`, type: 'ERROR', subscriberId: invoice.subscriber?.id, link: '/billing' });
    return result;
  }

  // ── Quotations ─────────────────────────────────────────────

  async listQuotations(filters?: { status?: string }) {
    const where: any = {};
    if (filters?.status) where.status = filters.status;
    return this.prisma.quotation.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getQuotation(id: string) {
    const q = await this.prisma.quotation.findUnique({ where: { id }, include: { items: true } });
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }

  async createQuotation(data: {
    subscriberId?: string;
    subscriberName: string;
    subscriberEmail?: string;
    subscriberPhone?: string;
    subscriberAddress?: string;
    validUntil?: Date;
    items: { description: string; quantity: number; unitPriceKobo: number }[];
    discountKobo?: number;
    notes?: string;
  }) {
    const quotationNumber = await this.nextQuotationNumber();
    const subtotalKobo = data.items.reduce((s, i) => s + i.unitPriceKobo * i.quantity, 0);
    const discountKobo = data.discountKobo ?? 0;
    const vatKobo = Math.round((subtotalKobo - discountKobo) * 0.075);
    const totalKobo = subtotalKobo - discountKobo + vatKobo;

    return this.prisma.quotation.create({
      data: {
        quotationNumber,
        subscriberId: data.subscriberId,
        subscriberName: data.subscriberName,
        subscriberEmail: data.subscriberEmail,
        subscriberPhone: data.subscriberPhone,
        subscriberAddress: data.subscriberAddress,
        validUntil: data.validUntil,
        subtotalKobo,
        vatKobo,
        discountKobo,
        totalKobo,
        notes: data.notes,
        items: { createMany: { data: data.items.map(i => ({ description: i.description, quantity: i.quantity, unitPriceKobo: i.unitPriceKobo, amountKobo: i.unitPriceKobo * i.quantity })) } },
      },
      include: { items: true },
    });
  }

  async updateQuotationStatus(id: string, status: string) {
    const valid = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'];
    if (!valid.includes(status)) throw new BadRequestException('Invalid status');
    return this.prisma.quotation.update({
      where: { id },
      data: { status: status as any },
      include: { items: true },
    });
  }

  // ── Receipts ───────────────────────────────────────────────

  async listReceipts(invoiceId?: string) {
    const where: any = {};
    if (invoiceId) where.invoiceId = invoiceId;
    return this.prisma.receipt.findMany({
      where,
      include: { invoice: { select: { invoiceNumber: true, subscriber: { select: { user: { select: { email: true } } } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Payments ───────────────────────────────────────────────

  async listPayments(filters?: { status?: string }) {
    const where: any = {};
    if (filters?.status) where.status = filters.status;
    return this.prisma.payment.findMany({
      where,
      include: { invoice: { select: { invoiceNumber: true, subscriber: { select: { user: { select: { email: true } } } } } }, refunds: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Credit Notes ───────────────────────────────────────────

  async issueCreditNote(invoiceId: string, amountKobo: number, reason: string) {
    const year = new Date().getFullYear();
    const last = await this.prisma.creditNote.findFirst({
      where: { creditNoteNumber: { startsWith: `CN-${year}` } },
      orderBy: { createdAt: 'desc' },
    });
    const seq = last ? parseInt(last.creditNoteNumber.split('-').pop()!, 10) + 1 : 1;
    const creditNoteNumber = `CN-${year}-${String(seq).padStart(6, '0')}`;

    return this.prisma.creditNote.create({
      data: { creditNoteNumber, invoiceId, amountKobo, reason },
    });
  }

  // ── Monthly Revenue Series (for charts) ────────────────────

  async monthlyRevenue() {
    const year = new Date().getFullYear();
    const data = await this.prisma.payment.findMany({
      where: { status: 'SUCCESSFUL', paidAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
      select: { amountKobo: true, paidAt: true },
    });
    const months = Array.from({ length: 12 }, (_, i) => ({
      name: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i],
      revenue: 0,
      collected: 0,
    }));
    for (const p of data) {
      if (p.paidAt) {
        const m = p.paidAt.getMonth();
        months[m].revenue += p.amountKobo;
        months[m].collected += p.amountKobo;
      }
    }
    return months.map(m => ({ ...m, revenue: Math.round(m.revenue / 100), collected: Math.round(m.collected / 100) }));
  }

  private assertTransition(current: InvoiceStatus, target: InvoiceStatus) {
    if (!TRANSITIONS[current]?.includes(target)) {
      throw new Error(`Invalid invoice transition: ${current} \u2192 ${target}`);
    }
  }
}
