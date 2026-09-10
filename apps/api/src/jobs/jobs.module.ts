import { Module, OnModuleInit, Optional } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SuspensionProcessor } from './suspension.processor';
import { DataSimulatorProcessor } from './data-simulator.processor';
import { RouterHeartbeatProcessor } from './router-heartbeat.processor';
import { RouterHealthModule } from '../modules/router-health/router-health.module';

const enableDataSimulator = process.env.ENABLE_DATA_SIMULATOR === 'true';

// Keep Redis from growing unbounded and retry transient failures with backoff.
const JOB_DEFAULTS = {
  removeOnComplete: true,
  removeOnFail: 500,
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
};

@Module({
  imports: [
    RouterHealthModule,
    BullModule.registerQueue(
      { name: 'suspension', defaultJobOptions: JOB_DEFAULTS },
      { name: 'data-simulator', defaultJobOptions: JOB_DEFAULTS },
      { name: 'router-heartbeat', defaultJobOptions: JOB_DEFAULTS },
    ),
  ],
  providers: [
    SuspensionProcessor,
    RouterHeartbeatProcessor,
    ...(enableDataSimulator ? [DataSimulatorProcessor] : []),
  ],
})
export class JobsModule implements OnModuleInit {
  constructor(
    @InjectQueue('suspension') private readonly suspensionQueue: Queue,
    @InjectQueue('router-heartbeat') private readonly heartbeatQueue: Queue,
    @Optional() @InjectQueue('data-simulator') private readonly simulatorQueue?: Queue,
  ) {}

  async onModuleInit() {
    await this.suspensionQueue.upsertJobScheduler('hourly-suspension-check', {
      pattern: '30 * * * *',
    });
    if (enableDataSimulator && this.simulatorQueue) {
      await this.simulatorQueue.upsertJobScheduler('data-simulator', {
        pattern: '* * * * *',
      });
    }
    await this.heartbeatQueue.upsertJobScheduler('router-heartbeat-check', {
      pattern: '*/30 * * * * *',
    });
  }
}