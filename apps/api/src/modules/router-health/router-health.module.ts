import { Module } from '@nestjs/common';
import { RouterOsModule } from '../routeros/routeros.module';
import { RouterHealthController } from './router-health.controller';
import { RouterHealthService } from './router-health.service';

@Module({
  imports: [RouterOsModule],
  controllers: [RouterHealthController],
  providers: [RouterHealthService],
  exports: [RouterHealthService],
})
export class RouterHealthModule {}
