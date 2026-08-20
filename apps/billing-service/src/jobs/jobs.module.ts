import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InvoiceGeneratorProcessor } from './invoice-generator.processor';
import { OverdueProcessor } from './overdue.processor';
import { RadiusClientService } from '../modules/radius/radius-client.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'invoice-generator' },
      { name: 'overdue' },
    ),
  ],
  providers: [
    InvoiceGeneratorProcessor,
    OverdueProcessor,
    RadiusClientService,
  ],
})
export class JobsModule implements OnModuleInit {
  constructor(
    @InjectQueue('invoice-generator') private readonly invoiceQueue: Queue,
    @InjectQueue('overdue') private readonly overdueQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.invoiceQueue.upsertJobScheduler('daily-invoice-gen', {
      pattern: '0 2 * * *',
    });
    await this.overdueQueue.upsertJobScheduler('hourly-overdue-check', {
      pattern: '0 * * * *',
    });
  }
}