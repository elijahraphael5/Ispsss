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
      newExpiry.setDate(newExpiry.getDate() + 30);

      const vatKobo = Math.round(sub.plan.priceKobo * 0.075);

      const count = await this.prisma.invoice.count();
      const invoiceNumber = `INV-${now.getFullYear()}-${String(count + 1).padStart(6, '0')}`;

      await this.prisma.invoice.create({
        data: {
          invoiceNumber,
          subscriberId: sub.subscriberId,
          type: 'SUBSCRIPTION',
          amountKobo: sub.plan.priceKobo + vatKobo,
          subtotalKobo: sub.plan.priceKobo,
          vatKobo,
          discountKobo: 0,
          dueAt: now,
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

      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { expiresAt: newExpiry },
      });

      created++;
    }

    this.logger.log(`Generated ${created} invoices`);
  }
}
