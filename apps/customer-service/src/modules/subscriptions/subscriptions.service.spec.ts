import { Test } from '@nestjs/testing';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantService } from '../../common/tenant/tenant.service';
import { AuditService } from '../audit-logs/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  const prisma = {
    subscriber: { findMany: jest.fn(), count: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    plan: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    subscription: { create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    invoice: { findMany: jest.fn(), deleteMany: jest.fn() },
    invoiceLine: { deleteMany: jest.fn() },
    creditNote: { deleteMany: jest.fn() },
    receipt: { deleteMany: jest.fn() },
    refund: { deleteMany: jest.fn() },
    payment: { findMany: jest.fn(), deleteMany: jest.fn() },
    wallet: { findMany: jest.fn(), deleteMany: jest.fn() },
    walletTransaction: { deleteMany: jest.fn() },
    cpe: { deleteMany: jest.fn() },
    ticket: { deleteMany: jest.fn() },
    ticketComment: { deleteMany: jest.fn() },
    chatSession: { deleteMany: jest.fn() },
    chatMessage: { deleteMany: jest.fn() },
    contract: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const tenant = { resolveTenant: jest.fn().mockResolvedValue('tenant-1') };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantService, useValue: tenant },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(SubscriptionsService);
  });

  describe('findAll', () => {
    it('paginates subscribers without filters', async () => {
      prisma.subscriber.findMany.mockResolvedValue([{ id: 's1' }]);
      prisma.subscriber.count.mockResolvedValue(1);
      const result = await service.findAll(0, 10);
      expect(result).toEqual({ data: [{ id: 's1' }], total: 1, skip: 0, take: 10 });
      expect(prisma.subscriber.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 10 }));
    });

    it('adds email/phone OR search filter', async () => {
      prisma.subscriber.findMany.mockResolvedValue([]);
      prisma.subscriber.count.mockResolvedValue(0);
      await service.findAll(0, 50, 'user@x.co');
      const where = prisma.subscriber.findMany.mock.calls[0][0].where;
      expect(where.OR).toHaveLength(2);
    });

    it('filters by plan type when planFilter set', async () => {
      prisma.subscriber.findMany.mockResolvedValue([]);
      prisma.subscriber.count.mockResolvedValue(0);
      await service.findAll(0, 50, undefined, 'BUSINESS');
      const where = prisma.subscriber.findMany.mock.calls[0][0].where;
      expect(where.subscriptions.some.plan.type).toBe('BUSINESS');
    });
  });

  describe('findOne', () => {
    it('returns subscriber with user and subscriptions', async () => {
      const row = { id: 's1', subscriptions: [] };
      prisma.subscriber.findUniqueOrThrow.mockResolvedValue(row);
      expect(await service.findOne('s1')).toBe(row);
    });
  });

  describe('create', () => {
    it('creates subscriber with resolved tenant, audits, and notifies', async () => {
      const row = { id: 's1', user: { email: 'a@b.co' } };
      prisma.subscriber.create.mockResolvedValue(row);
      const result = await service.create({ userId: 'u1', type: 'RESIDENTIAL', address: '2nd St' });
      expect(result).toBe(row);
      expect(prisma.subscriber.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant-1', userId: 'u1', type: 'RESIDENTIAL', address: '2nd St' },
        include: expect.anything(),
      });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUBSCRIBER_CREATED' }));
      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Account Created' }));
    });
  });

  describe('update', () => {
    it('updates and audits', async () => {
      prisma.subscriber.update.mockResolvedValue({ id: 's1' });
      await service.update('s1', { status: 'SUSPENDED' });
      expect(prisma.subscriber.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'SUSPENDED' }, include: expect.anything() });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUBSCRIBER_UPDATED' }));
    });
  });

  describe('remove', () => {
    it('hard-deletes the subscriber with cascades inside a transaction', async () => {
      prisma.invoice.findMany.mockResolvedValue([{ id: 'i1' }]);
      prisma.payment.findMany.mockResolvedValue([{ id: 'p1' }]);
      prisma.wallet.findMany.mockResolvedValue([{ id: 'w1' }]);
      prisma.subscriber.delete.mockResolvedValue({ id: 's1' });
      prisma.$transaction.mockImplementation((fn: (tx: any) => Promise<any>) => fn(prisma));

      const result = await service.remove('s1');
      expect(result).toEqual({ id: 's1' });
      expect(prisma.invoiceLine.deleteMany).toHaveBeenCalledWith({ where: { invoiceId: { in: ['i1'] } } });
      expect(prisma.wallet.deleteMany).toHaveBeenCalled();
      expect(prisma.subscriber.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUBSCRIBER_DELETED' }));
    });
  });

  describe('plans', () => {
    it('listPlans orders by createdAt desc', async () => {
      prisma.plan.findMany.mockResolvedValue([{ id: 'p1' }]);
      expect(await service.listPlans()).toEqual([{ id: 'p1' }]);
    });

    it('createPlan creates with tenant and audits', async () => {
      prisma.plan.create.mockResolvedValue({ id: 'p1' });
      const result = await service.createPlan({ name: 'Pro', priceKobo: 200000 });
      expect(result).toEqual({ id: 'p1' });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLAN_CREATED' }));
    });

    it('updatePlan updates and audits', async () => {
      prisma.plan.update.mockResolvedValue({ id: 'p1' });
      await service.updatePlan('p1', { priceKobo: 250000 });
      expect(prisma.plan.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { priceKobo: 250000 } });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLAN_UPDATED' }));
    });
  });

  describe('subscriptions', () => {
    it('createSubscription creates with defaults and audits', async () => {
      const created = { id: 'sub1', plan: {}, subscriber: { id: 's1', userId: 'u1' } };
      prisma.subscription.create.mockResolvedValue(created);
      const result = await service.createSubscription({ subscriberId: 's1', planId: 'p1', expiresAt: new Date('2026-09-01') });
      expect(result).toBe(created);
      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ autoRenew: true, installationFeeKobo: undefined }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUBSCRIPTION_CREATED' }));
    });

    it('updateSubscription updates and audits', async () => {
      prisma.subscription.update.mockResolvedValue({ id: 'sub1', plan: {} });
      await service.updateSubscription('sub1', { planId: 'p2', autoRenew: false });
      expect(prisma.subscription.update).toHaveBeenCalledWith({ where: { id: 'sub1' }, data: { planId: 'p2', autoRenew: false }, include: { plan: true } });
    });

    it('removeSubscription cancels and audits', async () => {
      prisma.subscription.update.mockResolvedValue({ id: 'sub1' });
      await service.removeSubscription('sub1');
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub1' },
        data: { cancelledAt: expect.any(Date) },
      });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUBSCRIPTION_CANCELLED' }));
    });
  });
});