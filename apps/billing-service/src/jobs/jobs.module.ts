import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InvoiceGeneratorProcessor } from './invoice-generator.processor';
import { OverdueProcessor } from './overdue.processor';
import { ExpiryReminderProcessor } from './expiry-reminder.processor';
import { RadiusClientService } from '../modules/radius/radius-client.service';

// Keep Redis from growing unbounded and retry transient failures with backoff.
const JOB_DEFAULTS = {
  removeOnComplete: true,
  removeOnFail: 500,
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
};

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'invoice-generator', defaultJobOptions: JOB_DEFAULTS },
      { name: 'overdue', defaultJobOptions: JOB_DEFAULTS },
      { name: 'expiry-reminder', defaultJobOptions: JOB_DEFAULTS },
    ),
  ],
  providers: [
    InvoiceGeneratorProcessor,
    OverdueProcessor,
    ExpiryReminderProcessor,
    RadiusClientService,
  ],
})
export class JobsModule implements OnModuleInit {
  constructor(
    @InjectQueue('invoice-generator') private readonly invoiceQueue: Queue,
    @InjectQueue('overdue') private readonly overdueQueue: Queue,
    @InjectQueue('expiry-reminder') private readonly expiryReminderQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.invoiceQueue.upsertJobScheduler('daily-invoice-gen', {
      pattern: '0 2 * * *',
    });
    await this.overdueQueue.upsertJobScheduler('hourly-overdue-check', {
      pattern: '0 * * * *',
    });
    // Daily renewal reminders at 08:00 for subscriptions expiring within 5 days.
    await this.expiryReminderQueue.upsertJobScheduler('daily-expiry-reminders', {
      pattern: '0 8 * * *',
    });
  }
}