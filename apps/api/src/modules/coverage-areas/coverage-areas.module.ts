import { Module } from '@nestjs/common';
import { CoverageAreasController } from './coverage-areas.controller';
import { CoverageAreasService } from './coverage-areas.service';

@Module({
  controllers: [CoverageAreasController],
  providers: [CoverageAreasService],
})
export class CoverageAreasModule {}
