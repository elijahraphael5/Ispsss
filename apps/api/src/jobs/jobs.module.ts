import { Module, OnModuleInit, Optional } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SuspensionProcessor } from './suspension.processor';
import { DataSimulatorProcessor } from './data-simulator.processor';
import { RouterHeartbeatProcessor } from './router-heartbeat.processor';
import { RouterHealthModule } from '../modules/router-health/router-health.module';

const enableDataSimulator = process.env.ENABLE_DATA_SIMULATOR === 'true';

@Module({
  imports: [
    RouterHealthModule,
    BullModule.registerQueue(
      { name: 'suspension' },
      { name: 'data-simulator' },
      { name: 'router-heartbeat' },
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