import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { RouterHealthService } from '../modules/router-health/router-health.service';

@Processor('router-heartbeat')
export class RouterHeartbeatProcessor extends WorkerHost {
  private readonly logger = new Logger(RouterHeartbeatProcessor.name);

  constructor(private readonly routerHealthService: RouterHealthService) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Router heartbeat check started (job ${job.id})`);
    await this.routerHealthService.checkAll();
    this.logger.log('Router heartbeat check complete');
  }
}
