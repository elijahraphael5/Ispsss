import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Processor('invoice-generator')
export class InvoiceGeneratorProcessor extends WorkerHost {
  private readonly logger = new Logger(InvoiceGeneratorProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Invoice generation started (job ${job.id})`);

    const now = new Date();
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        cancelledAt: null,
        suspendedAt: null,
        expiresAt: { lte: now },
      },
      include: { plan: true, subscriber: true },
    });

    let created = 0;
    for (const sub of subscriptions) {
      if (!sub.expiresAt) continue;
      const newExpiry = new Date(sub.expiresAt);
      // Add one month correctly (handle month-end)
      const day = newExpiry.getDate();
      newExpiry.setMonth(newExpiry.getMonth() + 1);
      if (newExpiry.getDate() < day) newExpiry.setDate(0);

      const vatKobo = Math.round(sub.plan.priceKobo * 0.075);

      // Use prefix-scoped sequence via findFirst orderBy invoiceNumber desc inside transaction
      const year = now.getFullYear();
      const prefix = `INV-${year}-`;
      let invoiceNumber: string | null = null;
      await this.prisma.$transaction(async (tx) => {
        const last = await tx.invoice.findFirst({
          where: { invoiceNumber: { startsWith: prefix } },
          orderBy: { invoiceNumber: 'desc' },
          select: { invoiceNumber: true },
        });
        const seq = last ? parseInt(last.invoiceNumber.split('-').pop() || '0', 10) + 1 : 1;
        invoiceNumber = `${prefix}${String(seq).padStart(6, '0')}`;

        await tx.invoice.create({
          data: {
            invoiceNumber: invoiceNumber!,
            subscriberId: sub.subscriberId,
            type: 'SUBSCRIPTION',
            amountKobo: sub.plan.priceKobo + vatKobo,
            subtotalKobo: sub.plan.priceKobo,
            vatKobo,
            discountKobo: 0,
            dueAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
            status: 'DRAFT',
            lines: {
              create: {
                description: `${sub.plan.name} — ${sub.plan.speedMbps}Mbps`,
                amountKobo: sub.plan.priceKobo,
                quantity: 1,
              },
            },
          },
        });

        await tx.subscription.update({
          where: { id: sub.id },
          data: { expiresAt: newExpiry },
        });
      });

      created++;
    }

    this.logger.log(`Generated ${created} invoices`);
  }
}
