import { Module } from '@nestjs/common';
import { RouterOsController } from './routeros.controller';
import { RouterOsService } from './routeros.service';
import { RouterSnapshotService } from './router-snapshot.service';
import { ActionQueueService } from './action-queue.service';

@Module({
  controllers: [RouterOsController],
  providers: [RouterOsService, RouterSnapshotService, ActionQueueService],
  exports: [RouterOsService, RouterSnapshotService, ActionQueueService],
})
export class RouterOsModule {}
