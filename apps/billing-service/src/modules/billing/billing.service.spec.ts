import { Test } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PdfService } from './pdf.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantService } from '../../common/tenant/tenant.service';
import { AuditService } from '../audit-logs/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';

describe('BillingService', () => {
  let service: BillingService;
  const year = new Date().getFullYear();
  const prisma = {
    invoice: { findFirst: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), aggregate: jest.fn(), groupBy: jest.fn(), count: jest.fn() },
    quotation: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    receipt: { findFirst: jest.fn(), findMany: jest.fn() },
    payment: { findMany: jest.fn(), aggregate: jest.fn() },
    creditNote: { findFirst: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn(), create: jest.fn() },
    subscriber: { findUnique: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };
  const tenant = { resolveTenant: jest.fn().mockResolvedValue('tenant1') };
  const mail = {
    sendInvoiceEmail: jest.fn().mockResolvedValue(undefined),
    sendQuotationEmail: jest.fn().mockResolvedValue(undefined),
  };
  const pdf = {
    invoicePdf: jest.fn().mockResolvedValue({ invoiceNumber: 'INV-1', buffer: Buffer.from('%PDF') }),
    quotationPdf: jest.fn().mockResolvedValue({ quotationNumber: 'QTN-1', buffer: Buffer.from('%PDF') }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantService, useValue: tenant },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: notifications },
        { provide: MailService, useValue: mail },
        { provide: PdfService, useValue: pdf },
      ],
    }).compile();
    service = moduleRef.get(BillingService);
  });

  describe('invoice numbering', () => {
    it('starts SUBSCRIPTION sequence at 000001 when no invoice exists', async () => {
      prisma.invoice.findFirst.mockResolvedValue(null);
      prisma.invoice.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'inv1' }));
      await service.create(
        { subscriberId: 's1', type: 'SUBSCRIPTION', dueAt: new Date(), lines: [{ description: 'Plan A', amountKobo: 5000 }] },
        'u1',
      );
      expect(prisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ invoiceNumber: `INV-${year}-000001` }) }),
      );
    });

    it('increments the sequence from the last invoice', async () => {
      const last = { invoiceNumber: `INV-${year}-000042` };
      prisma.invoice.findFirst.mockResolvedValue(last);
      prisma.invoice.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'inv1' }));
      await service.create(
        { subscriberId: 's1', type: 'SUBSCRIPTION', dueAt: new Date(), lines: [{ description: 'Plan A', amountKobo: 5000 }] },
        'u1',
      );
      expect(prisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ invoiceNumber: `INV-${year}-000043` }) }),
      );
    });

    it('uses the INSTALLATION prefix for installation invoices', async () => {
      prisma.invoice.findFirst.mockResolvedValue(null);
      prisma.invoice.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'inv1' }));
      await service.create(
        { subscriberId: 's1', type: 'INSTALLATION', dueAt: new Date(), lines: [{ description: 'Install', amountKobo: 10000 }] },
        'u1',
      );
      expect(prisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ invoiceNumber: `INV-INS-${year}-000001` }) }),
      );
    });
  });

  describe('invoice amounts', () => {
    it('rejects invoice creation without a customer', async () => {
      await expect(
        service.create({ type: 'SUBSCRIPTION', dueAt: new Date(), lines: [{ description: 'X', amountKobo: 10000 }] }, 'u1'),
      ).rejects.toThrow(/Either subscriberId or newCustomer.email is required/);
    });

    it('creates a new customer (user + subscriber) when newCustomer is provided', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'newuser1', email: 'new@x.com' });
      prisma.subscriber.create.mockResolvedValue({ id: 'newsub1' });
      prisma.invoice.findFirst.mockResolvedValue(null);
      prisma.invoice.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'inv1' }));
      await service.create(
        { newCustomer: { name: 'New Person', email: 'new@x.com', phone: '+2341', address: 'Lagos' }, type: 'SUBSCRIPTION', dueAt: new Date(), lines: [{ description: 'X', amountKobo: 10000 }] },
        'u1',
      );
      expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: 'new@x.com', name: 'New Person', phone: '+2341', tenantId: 'tenant1' }) }));
      expect(prisma.subscriber.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'newuser1', type: 'RESIDENTIAL', status: 'ACTIVE', address: 'Lagos', tenantId: 'tenant1' }) }));
      expect(prisma.invoice.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subscriberId: 'newsub1' }) }));
    });

    it('reuses the existing subscriber when newCustomer email already exists (no duplicate)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing', email: 'new@x.com', subscriber: { id: 'sub1' } });
      prisma.invoice.findFirst.mockResolvedValue(null);
      prisma.invoice.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'inv2' }));
      await service.create(
        { newCustomer: { name: 'New Person', email: 'new@x.com' }, type: 'SUBSCRIPTION', dueAt: new Date(), lines: [{ description: 'X', amountKobo: 10000 }] },
        'u1',
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.subscriber.create).not.toHaveBeenCalled();
      expect(prisma.invoice.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subscriberId: 'sub1' }) }));
    });

    it('creates a subscriber for an existing user that has none yet', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing', email: 'new@x.com', subscriber: null });
      prisma.subscriber.create.mockResolvedValue({ id: 'newsub2' });
      prisma.invoice.findFirst.mockResolvedValue(null);
      prisma.invoice.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'inv3' }));
      await service.create(
        { newCustomer: { name: 'New Person', email: 'new@x.com', address: 'Lagos' }, type: 'SUBSCRIPTION', dueAt: new Date(), lines: [{ description: 'X', amountKobo: 10000 }] },
        'u1',
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.subscriber.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'existing', status: 'ACTIVE', address: 'Lagos' }) }));
      expect(prisma.invoice.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subscriberId: 'newsub2' }) }));
    });

    it('computes subtotal, default 7.5% VAT and total (kobo integers, no floats)', async () => {
      prisma.invoice.findFirst.mockResolvedValue(null);
      prisma.invoice.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'inv1' }));
      await service.create(
        {
          subscriberId: 's1',
          type: 'SUBSCRIPTION',
          dueAt: new Date(),
          lines: [
            { description: 'Plan', amountKobo: 200000, quantity: 2 },
            { description: 'Rental', amountKobo: 5000 },
          ],
        },
        'u1',
      );
      const data = prisma.invoice.create.mock.calls[0][0].data;
      expect(data.subtotalKobo).toBe(405000);
      expect(data.vatKobo).toBe(Math.round(405000 * 0.075));
      expect(data.amountKobo).toBe(405000 + Math.round(405000 * 0.075));
    });

    it('honours an explicit VAT override and discount', async () => {
      prisma.invoice.findFirst.mockResolvedValue(null);
      prisma.invoice.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'inv1' }));
      await service.create(
        { subscriberId: 's1', type: 'ONE_TIME', dueAt: new Date(), lines: [{ description: 'X', amountKobo: 10000 }], discountKobo: 1000, vatKobo: 0 },
        'u1',
      );
      const data = prisma.invoice.create.mock.calls[0][0].data;
      expect(data.amountKobo).toBe(9000);
      expect(data.lines).toEqual({ createMany: { data: [{ description: 'X', amountKobo: 10000, quantity: 1 }] } });
    });
  });

  describe('state machine', () => {
    it('issues a DRAFT invoice and records the transition in the audit log', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'inv1', status: 'DRAFT', invoiceNumber: `INV-${year}-000001`, amountKobo: 5000 });
      prisma.invoice.update.mockResolvedValue({ id: 'inv1', status: 'ISSUED', issuedAt: new Date() });
      await service.issue('inv1', 'u1');
      expect(prisma.invoice.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'inv1' }, data: expect.objectContaining({ status: 'ISSUED', issuedAt: expect.any(Date) }) }));
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'INVOICE_ISSUED', actorId: 'u1' }));
    });

    it('rejects issuing an already PAID invoice', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'inv1', status: 'PAID', invoiceNumber: 'INV-1', amountKobo: 5000 });
      await expect(service.issue('inv1', 'u1')).rejects.toThrow(/Invalid invoice transition: PAID → ISSUED/);
    });

    it('emails the invoice PDF to the override email when issuing', async () => {
      const inv = {
        id: 'inv1', status: 'DRAFT', invoiceNumber: `INV-${year}-000001`, amountKobo: 5000, type: 'SUBSCRIPTION',
        dueAt: new Date(), issuedAt: null, paidAt: null, subtotalKobo: 5000, vatKobo: 375, discountKobo: 0, notes: null,
        lines: [{ id: 'l1', description: 'Plan', amountKobo: 5000, quantity: 1 }],
        subscriber: { id: 's1', user: { id: 'u1', email: 'owner@x.com' } },
      };
      prisma.invoice.findUniqueOrThrow.mockResolvedValue(inv);
      prisma.invoice.update.mockResolvedValue({ ...inv, status: 'ISSUED', issuedAt: new Date() });
      await service.issue('inv1', 'u1', 'override@x.com');
      expect(mail.sendInvoiceEmail).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'override@x.com', invoiceNumber: `INV-${year}-000001`, amountKobo: 5000 }),
      );
      expect(pdf.invoicePdf).toHaveBeenCalled();
    });

    it('falls back to the subscriber email when no override is given', async () => {
      const inv = {
        id: 'inv1', status: 'DRAFT', invoiceNumber: `INV-${year}-000001`, amountKobo: 5000, type: 'SUBSCRIPTION',
        dueAt: new Date(), issuedAt: null, paidAt: null, subtotalKobo: 5000, vatKobo: 375, discountKobo: 0, notes: null,
        lines: [], subscriber: { id: 's1', user: { id: 'u1', email: 'owner@x.com' } },
      };
      prisma.invoice.findUniqueOrThrow.mockResolvedValue(inv);
      prisma.invoice.update.mockResolvedValue({ ...inv, status: 'ISSUED', issuedAt: new Date() });
      await service.issue('inv1', 'u1');
      expect(mail.sendInvoiceEmail).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'owner@x.com' }),
      );
    });

    it('emails the quotation PDF when a quotation is marked SENT', async () => {
      const q = {
        id: 'q1', quotationNumber: `QTN-${year}-000001`, status: 'DRAFT', validUntil: new Date(),
        subtotalKobo: 10000, vatKobo: 750, discountKobo: 0, totalKobo: 10750, notes: null,
        items: [{ id: 'i1', description: 'Fibre', quantity: 1, unitPriceKobo: 10000, amountKobo: 10000 }],
        subscriberName: 'Jane Doe', subscriberEmail: 'jane@x.com', subscriberPhone: null, subscriberAddress: null,
      };
      prisma.quotation.update.mockResolvedValue({ ...q, status: 'SENT' });
      await service.updateQuotationStatus('q1', 'SENT');
      expect(mail.sendQuotationEmail).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'jane@x.com', quotationNumber: `QTN-${year}-000001`, totalKobo: 10750 }),
      );
    });

    it('rejects marking a DRAFT invoice paid directly (must be issued first)', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'inv1', status: 'DRAFT', invoiceNumber: 'INV-1', amountKobo: 5000, payments: [] });
      await expect(service.markPaid('inv1')).rejects.toThrow(/Invalid invoice transition: DRAFT → PAID/);
    });

    it('marks an ISSUED invoice paid with payment data, creating payment + receipt in a transaction', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'inv1', status: 'ISSUED', invoiceNumber: `INV-${year}-000001`, amountKobo: 5000, payments: [] });
      prisma.receipt.findFirst.mockResolvedValue(null);
      const tx = {
        payment: { upsert: jest.fn().mockResolvedValue({}) },
        receipt: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
        invoice: { update: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      prisma.invoice.findUnique.mockResolvedValue({ id: 'inv1', status: 'PAID', invoiceNumber: `INV-${year}-000001`, lines: [], payments: [], receipts: [] });
      await service.markPaid('inv1', { provider: 'PAYSTACK', reference: 'PAY-1', amountKobo: 5000 });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.payment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reference: 'PAY-1' },
          create: expect.objectContaining({ invoiceId: 'inv1', reference: 'PAY-1', status: 'SUCCESSFUL' }),
          update: expect.objectContaining({ status: 'SUCCESSFUL' }),
        }),
      );
      expect(tx.receipt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ receiptNumber: `RCT-${year}-000001`, paymentMethod: 'PAYSTACK' }),
      });
      expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv1' }, data: expect.objectContaining({ status: 'PAID', paidAt: expect.any(Date) }) });
    });

    it('marks an OVERDUE invoice paid without payment metadata (wallet path)', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'inv1', status: 'OVERDUE', invoiceNumber: 'INV-1', amountKobo: 5000, payments: [] });
      prisma.invoice.update.mockResolvedValue({ id: 'inv1', status: 'PAID', paidAt: new Date() });
      const result = await service.markPaid('inv1');
      expect(result!.status).toBe('PAID');
    });

    it('voids an ISSUED invoice but refuses to void a PAID one', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValueOnce({ id: 'inv1', status: 'ISSUED', invoiceNumber: 'INV-1', amountKobo: 5000 });
      prisma.invoice.update.mockResolvedValue({ id: 'inv1', status: 'VOID' });
      await service.voidInvoice('inv1', 'u1');
      expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv1' }, data: { status: 'VOID' } });

      prisma.invoice.findUniqueOrThrow.mockResolvedValueOnce({ id: 'inv2', status: 'PAID', invoiceNumber: 'INV-2', amountKobo: 5000 });
      await expect(service.voidInvoice('inv2', 'u1')).rejects.toThrow(/Invalid invoice transition: PAID → VOID/);
    });
  });

  describe('overdue', () => {
    it('marks ISSUED → OVERDUE and creates a notification', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'inv1', status: 'ISSUED', invoiceNumber: `INV-${year}-000001`, amountKobo: 5000, subscriber: { id: 's1' } });
      prisma.invoice.update.mockResolvedValue({ id: 'inv1', status: 'OVERDUE' });
      await service.markOverdue('inv1', 'u1');
      expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv1' }, data: { status: 'OVERDUE' } });
      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Invoice Overdue', type: 'ERROR' }));
    });

    it('rejects marking an already VOID invoice overdue', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'inv1', status: 'VOID', invoiceNumber: 'INV-1', amountKobo: 5000, subscriber: { id: 's1' } });
      await expect(service.markOverdue('inv1', 'u1')).rejects.toThrow(/Invalid invoice transition: VOID → OVERDUE/);
    });
  });

  describe('quotations', () => {
    it('creates a quotation with sequential number, VAT and item amounts', async () => {
      prisma.quotation.findFirst.mockResolvedValue(null);
      prisma.subscriber.findUnique.mockResolvedValue({ id: 'sub1', user: { name: 'Jane Doe', email: 'jane@example.com', phone: '+234' } });
      prisma.quotation.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'q1' }));
      await service.createQuotation({
        subscriberId: 'sub1',
        subscriberName: 'Jane Doe',
        items: [
          { description: 'Fibre 20Mbps', quantity: 1, unitPriceKobo: 50000 },
          { description: 'Router', quantity: 2, unitPriceKobo: 10000 },
        ],
      });
      const data = prisma.quotation.create.mock.calls[0][0].data;
      expect(data.subscriberId).toBe('sub1');
      expect(data.quotationNumber).toBe(`QTN-${year}-000001`);
      expect(data.subtotalKobo).toBe(70000);
      expect(data.vatKobo).toBe(Math.round(70000 * 0.075));
      expect(data.totalKobo).toBe(70000 + Math.round(70000 * 0.075));
      expect(data.items).toEqual({
        createMany: { data: [
          expect.objectContaining({ amountKobo: 50000 }),
          expect.objectContaining({ amountKobo: 20000 }),
        ] },
      });
    });

    it('reuses an existing subscriber when quotation is created with a known email', async () => {
      prisma.quotation.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'existing', email: 'jane@example.com', subscriber: { id: 'sub1' } });
      prisma.subscriber.findUnique.mockResolvedValue({ id: 'sub1', user: { name: 'Jane Doe', email: 'jane@example.com', phone: '+234' } });
      prisma.quotation.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'q2' }));
      await service.createQuotation({
        subscriberEmail: 'jane@example.com',
        items: [{ description: 'Fibre 20Mbps', quantity: 1, unitPriceKobo: 50000 }],
      });
      const data = prisma.quotation.create.mock.calls[0][0].data;
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(data.subscriberId).toBe('sub1');
      expect(data.subscriberName).toBe('Jane Doe');
      expect(data.subscriberEmail).toBe('jane@example.com');
    });

    it('requires a subscriberId or subscriberEmail for a quotation', async () => {
      await expect(
        service.createQuotation({ items: [{ description: 'X', quantity: 1, unitPriceKobo: 1000 }] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid quotation status', async () => {
      await expect(service.updateQuotationStatus('q1', 'NOPE')).rejects.toThrow(BadRequestException);
      expect(prisma.quotation.update).not.toHaveBeenCalled();
    });
  });

  describe('credit notes', () => {
    it('numbers credit notes CN-<year>-00000N and links the invoice', async () => {
      prisma.creditNote.findFirst.mockResolvedValue(null);
      prisma.creditNote.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'cn1' }));
      await service.issueCreditNote('inv1', 2000, 'Adjustment');
      expect(prisma.creditNote.create).toHaveBeenCalledWith({
        data: { creditNoteNumber: `CN-${year}-000001`, invoiceId: 'inv1', amountKobo: 2000, reason: 'Adjustment' },
      });
    });
  });

  describe('monthly revenue', () => {
    it('aggregates payments per month and converts kobo to naira', async () => {
      const paidAt = new Date(year, 6, 15);
      prisma.payment.findMany.mockResolvedValue([
        { amountKobo: 100000, paidAt },
        { amountKobo: 50000, paidAt },
      ]);
      const months = await service.monthlyRevenue();
      const july = months[6];
      expect(july.revenue).toBe(1500);
      expect(july.collected).toBe(1500);
      expect(months[0].revenue).toBe(0);
    });
  });

  describe('dashboard & lookups', () => {
    it('returns a NotFound for missing invoice detail', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nope')).rejects.toThrow(NotFoundException);
    });

    it('computes total outstanding and collection rate from dashboard aggregates', async () => {
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amountKobo: 1000 } });
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amountKobo: 1000 } });
      prisma.invoice.groupBy.mockResolvedValue([
        { status: 'PAID', _count: { id: 3 }, _sum: { amountKobo: 30000 } },
        { status: 'ISSUED', _count: { id: 1 }, _sum: { amountKobo: 5000 } },
      ]);
      prisma.invoice.aggregate.mockResolvedValue({ _sum: { amountKobo: 35000 } });
      const dash = await service.getDashboard();
      expect(dash.invoices.paid).toBe(3);
      expect(dash.collections.totalOutstanding).toBe(5000);
      expect(dash.collections.collectionRate).toBe(Math.round((30000 / 35000) * 100));
    });
  });
});