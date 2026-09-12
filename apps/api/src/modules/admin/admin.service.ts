import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly cache: CacheService) {}

  async getDashboard() {
    const cached = await this.cache.get<any>('admin:dashboard');
    if (cached) return cached;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalCustomers, activeSubs, pendingTickets, revenueMonth, outstandingInvoices, recentPayments, recentCustomers] = await Promise.all([
      this.prisma.subscriber.count({ where: { deletedAt: null } }),
      this.prisma.subscriber.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.ticket.count({ where: { status: 'OPEN' } }),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESSFUL', paidAt: { gte: startOfMonth } },
        _sum: { amountKobo: true },
      }),
      this.prisma.invoice.aggregate({
        where: { status: { in: ['ISSUED', 'OVERDUE'] } },
        _sum: { amountKobo: true },
      }),
      this.prisma.payment.findMany({
        where: { status: 'SUCCESSFUL' },
        include: {
          invoice: {
            select: { invoiceNumber: true, subscriber: { select: { user: { select: { email: true } } } } },
          },
        },
        orderBy: { paidAt: 'desc' },
        take: 6,
      }),
      this.prisma.subscriber.findMany({
        where: { deletedAt: null },
        include: {
          user: { select: { email: true, phone: true, createdAt: true } },
          subscriptions: { include: { plan: { select: { name: true, speedMbps: true, priceKobo: true } } }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const result = {
      stats: {
        totalCustomers,
        activeSubscriptions: activeSubs,
        pendingTickets,
        revenueThisMonth: revenueMonth._sum.amountKobo ?? 0,
        dueKobo: outstandingInvoices._sum.amountKobo ?? 0,
      },
      recentTransactions: recentPayments.map(p => ({
        id: p.id,
        amount: p.amountKobo,
        status: p.status,
        createdAt: p.paidAt ?? p.createdAt,
        subscriber: p.invoice?.subscriber?.user ? { email: p.invoice.subscriber.user.email } : null,
      })),
      recentCustomers: recentCustomers.map(s => ({
        id: s.id,
        email: s.user.email,
        phone: s.user.phone,
        branch: null,
        status: s.status,
        plan: s.subscriptions[0]?.plan ?? null,
        createdAt: s.user.createdAt,
      })),
    };
    await this.cache.set('admin:dashboard', result, 15);
    return result;
  }
}
