import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const [revenueMonth, revenueYear, subscriberCount, activeSubscribers, invoiceStats, ticketStats] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESSFUL', paidAt: { gte: startOfMonth } },
        _sum: { amountKobo: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESSFUL', paidAt: { gte: startOfYear } },
        _sum: { amountKobo: true },
      }),
      this.prisma.subscriber.count(),
      this.prisma.subscriber.count({ where: { status: 'ACTIVE' } }),
      this.prisma.invoice.groupBy({
        by: ['status'],
        _count: { id: true },
        _sum: { amountKobo: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
    ]);

    const invoiceMap: Record<string, { count: number; amount: number }> = {};
    for (const row of invoiceStats) {
      invoiceMap[row.status] = { count: row._count.id, amount: row._sum.amountKobo ?? 0 };
    }

    const ticketMap: Record<string, number> = {};
    for (const row of ticketStats) {
      ticketMap[row.status] = row._count.id;
    }

    return {
      revenueThisMonth: revenueMonth._sum.amountKobo ?? 0,
      revenueThisYear: revenueYear._sum.amountKobo ?? 0,
      totalSubscribers: subscriberCount,
      activeSubscribers,
      invoices: invoiceMap,
      tickets: ticketMap,
      generatedAt: new Date(),
    };
  }

  async findOne(id: string) {
    const now = new Date();

    switch (id) {
      case 'revenue': {
        const year = now.getFullYear();
        const data = await this.prisma.payment.findMany({
          where: { status: 'SUCCESSFUL', paidAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
          select: { amountKobo: true, paidAt: true },
        });
        const months = Array.from({ length: 12 }, (_, i) => ({
          month: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i],
          revenue: 0,
        }));
        for (const p of data) {
          if (p.paidAt) months[p.paidAt.getMonth()].revenue += p.amountKobo;
        }
        return { type: 'revenue', year, months: months.map(m => ({ ...m, revenue: Math.round(m.revenue / 100) })) };
      }

      case 'subscribers': {
        const year = now.getFullYear();
        const data = await this.prisma.subscriber.findMany({
          where: { createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
          select: { createdAt: true, type: true },
        });
        const months = Array.from({ length: 12 }, (_, i) => ({
          month: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i],
          newSubscribers: 0,
          residential: 0,
          business: 0,
        }));
        for (const s of data) {
          const m = s.createdAt.getMonth();
          months[m].newSubscribers++;
          if (s.type === 'RESIDENTIAL') months[m].residential++;
          else if (s.type === 'BUSINESS') months[m].business++;
        }
        const totalByType = await this.prisma.subscriber.groupBy({
          by: ['type'],
          _count: { id: true },
        });
        const typeBreakdown: Record<string, number> = {};
        for (const row of totalByType) typeBreakdown[row.type] = row._count.id;
        return { type: 'subscribers', year, months, totalByType: typeBreakdown, totalSubscribers: data.length };
      }

      case 'collections': {
        const totalInvoiced = await this.prisma.invoice.aggregate({
          _sum: { amountKobo: true },
          where: { status: { not: 'VOID' } },
        });
        const totalPaid = await this.prisma.payment.aggregate({
          _sum: { amountKobo: true },
          where: { status: 'SUCCESSFUL' },
        });
        const overdue = await this.prisma.invoice.aggregate({
          _sum: { amountKobo: true },
          where: { status: 'OVERDUE' },
        });
        const invoiced = totalInvoiced._sum.amountKobo ?? 0;
        const paid = totalPaid._sum.amountKobo ?? 0;
        return {
          type: 'collections',
          totalInvoicedKobo: invoiced,
          totalCollectedKobo: paid,
          outstandingKobo: invoiced - paid,
          overdueKobo: overdue._sum.amountKobo ?? 0,
          collectionRate: invoiced > 0 ? Math.round((paid / invoiced) * 100) : 0,
        };
      }

      default:
        return this.findAll();
    }
  }
}
