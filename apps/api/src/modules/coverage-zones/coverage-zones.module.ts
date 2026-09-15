import { Module } from '@nestjs/common';
import { CoverageZonesController } from './coverage-zones.controller';
import { CoverageZonesService } from './coverage-zones.service';

@Module({
  controllers: [CoverageZonesController],
  providers: [CoverageZonesService],
})
export class CoverageZonesModule {}
