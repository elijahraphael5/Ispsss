import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService) {}

  private async invalidateNotifications(): Promise<void> {
    await this.cache.invalidatePattern('notifications:*');
  }

  async findAll() {
    const tenantId = (await this.prisma.tenant.findFirst())?.id;
    const cacheKey = `notifications:${tenantId}`;
    const cached = await this.cache.get<any[]>(cacheKey);
    if (cached) return cached;
    await this.generateFromSystem(tenantId);
    const rows = await this.prisma.notification.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    await this.cache.set(cacheKey, rows, 10);
    return rows;
  }

  async create(data: { title: string; message: string; type?: string; subscriberId?: string; link?: string }) {
    const tenantId = (await this.prisma.tenant.findFirst())?.id;
    const created = await this.prisma.notification.create({
      data: { title: data.title, message: data.message, type: data.type ?? 'INFO', subscriberId: data.subscriberId, link: data.link },
    });
    await this.invalidateNotifications();
    return created;
  }

  async markRead(id: string) {
    const updated = await this.prisma.notification.update({ where: { id }, data: { read: true } });
    await this.invalidateNotifications();
    return updated;
  }

  async markAllRead() {
    const tenantId = (await this.prisma.tenant.findFirst())?.id;
    const result = await this.prisma.notification.updateMany({ where: { tenantId, read: false }, data: { read: true } });
    await this.invalidateNotifications();
    return result;
  }

  private async generateFromSystem(tenantId?: string) {
    const existing = tenantId ? await this.prisma.notification.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } }) : await this.prisma.notification.findFirst({ orderBy: { createdAt: 'desc' } });
    const lastRun = existing?.createdAt ?? new Date(0);
    const now = new Date();

    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const [newSubs, dueInvoices, criticalTickets, overdueInvoices] = await Promise.all([
      this.prisma.subscriber.findMany({ where: { createdAt: { gt: lastRun }, deletedAt: null }, include: { user: { select: { email: true } } }, take: 50 }),
      this.prisma.invoice.findMany({ where: { status: 'ISSUED', dueAt: { lte: threeDaysFromNow, gte: now } }, include: { subscriber: { select: { user: { select: { email: true } } } } }, take: 50 }),
      this.prisma.ticket.findMany({ where: { priority: { in: ['HIGH', 'URGENT'] }, status: { notIn: ['RESOLVED', 'CLOSED'] } }, include: { subscriber: { select: { user: { select: { email: true } } } } }, take: 50 }),
      this.prisma.invoice.findMany({ where: { status: 'OVERDUE' }, include: { subscriber: { select: { user: { select: { email: true } } } } }, take: 50 }),
    ]);

    const notifications: Array<{ tenantId?: string; type: string; title: string; message: string; link?: string }> = [];

    for (const sub of newSubs) {
      notifications.push({ type: 'INFO', title: 'New Account Created', message: `Customer ${sub.user.email} signed up`, link: `/subscriptions/subscribers` });
    }

    for (const inv of dueInvoices) {
      notifications.push({ type: 'WARNING', title: 'Payment Due Soon', message: `Invoice ${inv.invoiceNumber} for ${inv.subscriber?.user?.email ?? '—'} is due ${inv.dueAt.toLocaleDateString()}`, link: `/billing` });
    }

    for (const inv of overdueInvoices) {
      notifications.push({ type: 'ERROR', title: 'Overdue Invoice', message: `Invoice ${inv.invoiceNumber} for ${inv.subscriber?.user?.email ?? '—'} is overdue`, link: `/billing` });
    }

    for (const ticket of criticalTickets) {
      notifications.push({ type: 'ERROR', title: `Critical: ${ticket.subject}`, message: `Ticket from ${ticket.subscriber?.user?.email ?? '—'}`, link: `/tickets` });
    }

    if (notifications.length > 0) {
      await this.prisma.notification.createMany({ data: notifications });
    }
  }
}
