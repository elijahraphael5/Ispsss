import { Module } from '@nestjs/common';
import { NocController } from './noc.controller';
import { NocService } from './noc.service';
import { NocGateway } from './gateways/noc.gateway';

@Module({
  controllers: [NocController],
  providers: [NocService, NocGateway],
  exports: [NocService],
})
export class NocModule {}
