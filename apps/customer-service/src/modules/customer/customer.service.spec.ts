import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const subscriber = { id: 'sub1', userId: 'u1', status: 'ACTIVE', type: 'RESIDENTIAL', address: '1 Test St', createdAt: new Date('2026-01-01') };
const plan = { id: 'p1', name: 'Starter', speedMbps: 10, priceKobo: 100000, dataCapGb: 100, technology: 'FIBER' };
const subscription = { id: 's1', planId: 'p1', plan, startedAt: new Date('2026-01-01'), expiresAt: new Date('2026-02-01'), autoRenew: true, suspendedAt: null };
const cpe = { id: 'c1', name: 'CPE-1', macAddress: 'AA:BB', ipAddress: '10.0.0.2', status: 'ONLINE' };

describe('CustomerService', () => {
  let service: CustomerService;
  const prisma = {
    subscriber: { findFirst: jest.fn() },
    payment: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    invoice: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    receipt: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    plan: { findUnique: jest.fn() },
    subscription: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    invoiceLine: { create: jest.fn() },
    ticket: { findMany: jest.fn(), findUnique: jest.fn() },
    ticketComment: { create: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [CustomerService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(CustomerService);
  });

  describe('getDashboard', () => {
    it('returns subscriber, plan, subscription, cpe, outstanding amount', async () => {
      prisma.subscriber.findFirst.mockResolvedValue({
        ...subscriber,
        subscriptions: [subscription],
        devices: [cpe],
      });
      prisma.payment.findFirst.mockResolvedValue({ amountKobo: 50000, createdAt: new Date() });
      prisma.invoice.findFirst.mockResolvedValue({ id: 'i1', amountKobo: 40000, status: 'OVERDUE', dueAt: new Date() });

      const result = await service.getDashboard('u1');
      expect(result.subscriber.id).toBe('sub1');
      expect(result.plan!.name).toBe('Starter');
      expect(result.outstandingKobo).toBe(40000);
      expect(result.cpe!.ipAddress).toBe('10.0.0.2');
    });

    it('throws NotFoundException when subscriber is missing', async () => {
      prisma.subscriber.findFirst.mockResolvedValue(null);
      await expect(service.getDashboard('u1')).rejects.toThrow(NotFoundException);
    });

    it('returns zero outstanding for paid invoices only', async () => {
      prisma.subscriber.findFirst.mockResolvedValue({ ...subscriber, subscriptions: [], devices: [] });
      prisma.invoice.findFirst.mockResolvedValue({ id: 'i1', amountKobo: 40000, status: 'PAID', dueAt: new Date() });
      const result = await service.getDashboard('u1');
      expect(result.outstandingKobo).toBe(0);
    });
  });

  describe('getAnalytics', () => {
    it('aggregates billing trend by month and ticket stats', async () => {
      prisma.subscriber.findFirst.mockResolvedValue(subscriber);
      prisma.invoice.findMany.mockResolvedValue([
        { amountKobo: 50000, status: 'PAID', paidAt: new Date(), dueAt: new Date(), createdAt: new Date('2026-08-05') },
        { amountKobo: 50000, status: 'OVERDUE', paidAt: null, dueAt: new Date(), createdAt: new Date('2026-08-07') },
      ]);
      prisma.payment.findMany.mockResolvedValue([{ amountKobo: 20000, createdAt: new Date() }]);
      prisma.ticket.findMany.mockResolvedValue([
        { status: 'OPEN' },
        { status: 'CLOSED' },
      ]);

      const result = await service.getAnalytics('u1');
      expect(result.billingTrend).toHaveLength(12);
      const current = result.billingTrend[11];
      expect(current.total).toBe(100000);
      expect(current.paid).toBe(50000);
      expect(current.overdue).toBe(50000);
      expect(result.totalPaidKobo).toBe(20000);
      expect(result.ticketStats).toEqual({ total: 2, open: 1, resolved: 1 });
    });

    it('throws when subscriber missing', async () => {
      prisma.subscriber.findFirst.mockResolvedValue(null);
      await expect(service.getAnalytics('u1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('handleSubscriptionAction', () => {
    beforeEach(() => {
      jest.spyOn(service as any, 'verifyPaystackPayment').mockResolvedValue(true);
      prisma.subscriber.findFirst.mockResolvedValue({ ...subscriber, subscriptions: [{ ...subscription, plan }] });
      prisma.invoice.findFirst.mockResolvedValue(null);
      prisma.receipt.findFirst.mockResolvedValue(null);
      prisma.invoice.create.mockResolvedValue({ id: 'inv1' });
      prisma.payment.create.mockResolvedValue({ id: 'pay1' });
      prisma.receipt.create.mockResolvedValue({ id: 'r1' });
      const now = new Date('2026-08-13');
      jest.spyOn(global, 'Date').mockImplementation(() => now as any);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('change_plan updates the existing subscription and creates invoice/payment/receipt', async () => {
      prisma.plan.findUnique.mockResolvedValue(plan);
      prisma.subscription.update.mockResolvedValue({ ...subscription, planId: 'p1' });

      const result = await service.handleSubscriptionAction('u1', { action: 'change_plan', planId: 'p1', reference: 'ref-1' });
      expect(result).toEqual({ message: 'Plan changed to Starter' });
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ planId: 'p1', suspendedAt: null }) }),
      );
      expect(prisma.invoice.create).toHaveBeenCalled();
      expect(prisma.payment.create).toHaveBeenCalled();
      expect(prisma.receipt.create).toHaveBeenCalled();
    });

    it('renew extends expiry by 30 days and resumes suspension', async () => {
      const expires = new Date('2026-02-01');
      const existing = { ...subscription, plan, expiresAt: expires };
      prisma.subscriber.findFirst.mockResolvedValue({ ...subscriber, subscriptions: [existing] });
      prisma.subscription.update.mockResolvedValue(existing);

      const result = await service.handleSubscriptionAction('u1', { action: 'renew', reference: 'ref-2' });
      expect(result.message).toContain('Subscription renewed');
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ suspendedAt: null }) }),
      );
    });

    it('add_plan creates a new subscription', async () => {
      prisma.plan.findUnique.mockResolvedValue(plan);
      prisma.subscription.create.mockResolvedValue({ id: 's2' });
      const result = await service.handleSubscriptionAction('u1', { action: 'add_plan', planId: 'p1', reference: 'ref-3' });
      expect(result).toEqual({ message: 'Added plan: Starter' });
      expect(prisma.subscription.create).toHaveBeenCalled();
    });

    it('rejects unknown actions', async () => {
      await expect(service.handleSubscriptionAction('u1', { action: 'nuke', reference: 'r' })).rejects.toThrow(BadRequestException);
    });

    it('rejects when subscriber missing', async () => {
      prisma.subscriber.findFirst.mockResolvedValue(null);
      await expect(service.handleSubscriptionAction('u1', { action: 'renew', reference: 'r' })).rejects.toThrow(NotFoundException);
    });

    it('rejects when Paystack verification fails', async () => {
      jest.spyOn(service as any, 'verifyPaystackPayment').mockResolvedValue(false);
      await expect(service.handleSubscriptionAction('u1', { action: 'renew', reference: 'bad-ref' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('getInvoices / getPayments / getReceipts', () => {
    it.each([
      ['getInvoices', 'invoice'],
      ['getPayments', 'payment'],
      ['getReceipts', 'receipt'],
    ] as Array<[string, string]>)('%s lists rows for the subscriber', async (method, delegate) => {
      prisma.subscriber.findFirst.mockResolvedValue(subscriber);
      (prisma as any)[delegate].findMany.mockResolvedValue([{ id: 'x1' }]);
      const result = await (service as any)[method]('u1');
      expect(result).toEqual([{ id: 'x1' }]);
      expect((prisma as any)[delegate].findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.anything() }));
    });

    it('throws when subscriber missing', async () => {
      prisma.subscriber.findFirst.mockResolvedValue(null);
      await expect(service.getInvoices('u1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('tickets', () => {
    it('getTickets lists the customer tickets', async () => {
      prisma.subscriber.findFirst.mockResolvedValue(subscriber);
      prisma.ticket.findMany.mockResolvedValue([{ id: 't1' }]);
      const result = await service.getTickets('u1');
      expect(result).toEqual([{ id: 't1' }]);
    });

    it('getTicket returns the ticket when owned', async () => {
      prisma.subscriber.findFirst.mockResolvedValue(subscriber);
      prisma.ticket.findUnique.mockResolvedValue({ id: 't1', subscriberId: 'sub1' });
      const result = await service.getTicket('u1', 't1');
      expect(result.id).toBe('t1');
    });

    it('getTicket forbids tickets of other subscribers', async () => {
      prisma.subscriber.findFirst.mockResolvedValue(subscriber);
      prisma.ticket.findUnique.mockResolvedValue({ id: 't1', subscriberId: 'other' });
      await expect(service.getTicket('u1', 't1')).rejects.toThrow(ForbiddenException);
    });

    it('replyTicket creates a CUSTOMER comment with the user email', async () => {
      prisma.subscriber.findFirst.mockResolvedValue({ ...subscriber, user: { email: 'a@b.co' } });
      prisma.ticket.findUnique.mockResolvedValue({ id: 't1', subscriberId: 'sub1' });
      prisma.ticketComment.create.mockResolvedValue({ id: 'c1' });
      const result = await service.replyTicket('u1', 't1', { message: 'hello' });
      expect(result).toEqual({ id: 'c1' });
      expect(prisma.ticketComment.create).toHaveBeenCalledWith({
        data: {
          ticketId: 't1',
          authorId: 'u1',
          author: 'a@b.co',
          authorType: 'CUSTOMER',
          body: 'hello',
          internal: false,
        },
      });
    });

    it('replyTicket forbids replies on tickets of other subscribers', async () => {
      prisma.subscriber.findFirst.mockResolvedValue({ ...subscriber, user: { email: 'a@b.co' } });
      prisma.ticket.findUnique.mockResolvedValue({ id: 't1', subscriberId: 'other' });
      await expect(service.replyTicket('u1', 't1', { message: 'x' })).rejects.toThrow(ForbiddenException);
    });
  });
});