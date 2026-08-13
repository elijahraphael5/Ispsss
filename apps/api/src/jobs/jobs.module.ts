import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SuspensionProcessor } from './suspension.processor';
import { InvoiceGeneratorProcessor } from './invoice-generator.processor';
import { OverdueProcessor } from './overdue.processor';
import { DataSimulatorProcessor } from './data-simulator.processor';
import { RouterHeartbeatProcessor } from './router-heartbeat.processor';
import { RouterHealthModule } from '../modules/router-health/router-health.module';

@Module({
  imports: [
    RouterHealthModule,
    BullModule.registerQueue(
      { name: 'suspension' },
      { name: 'invoice-generator' },
      { name: 'overdue' },
      { name: 'data-simulator' },
      { name: 'router-heartbeat' },
    ),
  ],
  providers: [
    SuspensionProcessor,
    InvoiceGeneratorProcessor,
    OverdueProcessor,
    DataSimulatorProcessor,
    RouterHeartbeatProcessor,
  ],
})
export class JobsModule implements OnModuleInit {
  constructor(
    @InjectQueue('invoice-generator') private readonly invoiceQueue: Queue,
    @InjectQueue('overdue') private readonly overdueQueue: Queue,
    @InjectQueue('suspension') private readonly suspensionQueue: Queue,
    @InjectQueue('data-simulator') private readonly simulatorQueue: Queue,
    @InjectQueue('router-heartbeat') private readonly heartbeatQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.invoiceQueue.upsertJobScheduler('daily-invoice-gen', {
      pattern: '0 2 * * *',
    });
    await this.overdueQueue.upsertJobScheduler('hourly-overdue-check', {
      pattern: '0 * * * *',
    });
    await this.suspensionQueue.upsertJobScheduler('hourly-suspension-check', {
      pattern: '30 * * * *',
    });
    await this.simulatorQueue.upsertJobScheduler('data-simulator', {
      pattern: '* * * * *',
    });
    await this.heartbeatQueue.upsertJobScheduler('router-heartbeat-check', {
      pattern: '*/30 * * * * *',
    });
  }
}
