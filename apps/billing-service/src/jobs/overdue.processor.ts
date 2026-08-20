import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RadiusClientService } from '../modules/radius/radius-client.service';

@Processor('overdue')
export class OverdueProcessor extends WorkerHost {
  private readonly logger = new Logger(OverdueProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly radius: RadiusClientService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Overdue check started (job ${job.id})`);

    const now = new Date();
    const subscribers = await this.prisma.invoice.findMany({
      where: {
        status: 'ISSUED',
        dueAt: { lt: now },
      },
      select: { subscriberId: true },
    });

    const result = await this.prisma.invoice.updateMany({
      where: {
        status: 'ISSUED',
        dueAt: { lt: now },
      },
      data: { status: 'OVERDUE' },
    });

    if (result.count > 0) {
      this.logger.log(`Marked ${result.count} invoices as OVERDUE`);
      const affectedSubscriberIds = [...new Set(subscribers.map((s) => s.subscriberId))];
      for (const subscriberId of affectedSubscriberIds) {
        await this.radius.deactivate(subscriberId);
      }
    }
  }
}
