import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantService } from '../../common/tenant/tenant.service';
import { AuditService } from '../audit-logs/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

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

  async create(data: { userId: string; type: string; address?: string; pppoeUsername?: string; networkType?: string }) {
    const tenantId = await this.tenant.resolveTenant();
    const sub = await this.prisma.subscriber.create({
      data: { tenantId, userId: data.userId, type: data.type as any, address: data.address, pppoeUsername: data.pppoeUsername, networkType: data.networkType },
      include: { user: { select: { id: true, email: true, phone: true } } },
    });
    await this.audit.log({ action: 'SUBSCRIBER_CREATED', entityType: 'Subscriber', entityId: sub.id, metadata: { userId: data.userId, type: data.type } });
    await this.notifications.create({ title: 'New Account Created', message: `Customer ${sub.user?.email ?? '—'} signed up`, type: 'INFO', subscriberId: sub.id, link: '/subscriptions/subscribers' });
    return sub;
  }

  async update(id: string, data: { type?: string; status?: string }) {
    const sub = await this.prisma.subscriber.update({
      where: { id },
      data: data as any,
      include: { user: { select: { id: true, email: true, phone: true } } },
    });
    await this.audit.log({ action: 'SUBSCRIBER_UPDATED', entityType: 'Subscriber', entityId: id, metadata: data as any });
    return sub;
  }

  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const invoices = await tx.invoice.findMany({ where: { subscriberId: id }, select: { id: true } });
      const invoiceIds = invoices.map((i) => i.id);
      if (invoiceIds.length > 0) {
        await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await tx.creditNote.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await tx.receipt.deleteMany({ where: { invoiceId: { in: invoiceIds } } });

        const payments = await tx.payment.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } });
        const paymentIds = payments.map((p) => p.id);
        if (paymentIds.length > 0) {
          await tx.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
          await tx.refund.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        }

        await tx.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }

      const wallets = await tx.wallet.findMany({ where: { subscriberId: id }, select: { id: true } });
      const walletIds = wallets.map((w) => w.id);
      if (walletIds.length > 0) {
        await tx.walletTransaction.deleteMany({ where: { walletId: { in: walletIds } } });
        await tx.wallet.deleteMany({ where: { id: { in: walletIds } } });
      }

      await tx.cpe.deleteMany({ where: { subscriberId: id } });
      await tx.subscription.deleteMany({ where: { subscriberId: id } });
      await tx.ticketComment.deleteMany({ where: { ticket: { subscriberId: id } } });
      await tx.ticket.deleteMany({ where: { subscriberId: id } });
      await tx.chatMessage.deleteMany({ where: { session: { subscriberId: id } } });
      await tx.chatSession.deleteMany({ where: { subscriberId: id } });
      await tx.contract.deleteMany({ where: { subscriberId: id } });
      const deleted = await tx.subscriber.delete({ where: { id } });
      await this.audit.log({ action: 'SUBSCRIBER_DELETED', entityType: 'Subscriber', entityId: id });
      return deleted;
    });
  }

  async listPlans() {
    return this.prisma.plan.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createPlan(data: any) {
    const tenantId = await this.tenant.resolveTenant();
    const plan = await this.prisma.plan.create({ data: { tenantId, ...data } });
    await this.audit.log({ action: 'PLAN_CREATED', entityType: 'Plan', entityId: plan.id, metadata: { name: data.name, priceKobo: data.priceKobo } });
    return plan;
  }

  async updatePlan(id: string, data: any) {
    const plan = await this.prisma.plan.update({ where: { id }, data });
    await this.audit.log({ action: 'PLAN_UPDATED', entityType: 'Plan', entityId: id, metadata: data as any });
    return plan;
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
    return sub;
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

  async removeSubscription(id: string) {
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: { cancelledAt: new Date() },
    });
    await this.audit.log({ action: 'SUBSCRIPTION_CANCELLED', entityType: 'Subscription', entityId: id });
    return updated;
  }
}
