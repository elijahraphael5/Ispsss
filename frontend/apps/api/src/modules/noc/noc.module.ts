import { Module } from '@nestjs/common';
import { NocController } from './noc.controller';
import { NocService } from './noc.service';

@Module({
  controllers: [NocController],
  providers: [NocService],
  exports: [NocService],
})
export class NocModule {}
