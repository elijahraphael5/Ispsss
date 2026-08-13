import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

const GRACE_PERIOD_DAYS = parseInt(process.env.INVOICE_GRACE_PERIOD_DAYS ?? '3', 10);

@Processor('suspension')
export class SuspensionProcessor extends WorkerHost {
  private readonly logger = new Logger(SuspensionProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Suspension check triggered (job ${job.id})`);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - GRACE_PERIOD_DAYS);

    const overdueInvoices = await this.prisma.invoice.findMany({
      where: {
        status: 'OVERDUE',
        dueAt: { lte: cutoff },
      },
      include: { subscriber: true },
    });

    for (const invoice of overdueInvoices) {
      await this.prisma.subscriber.update({
        where: { id: invoice.subscriberId },
        data: { status: 'SUSPENDED' },
      });
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'OVERDUE' },
      });
    }
  }
}
