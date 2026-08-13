import { Module } from '@nestjs/common';
import { NocController } from './noc.controller';
import { NocService } from './noc.service';
import { NocGateway } from './gateways/noc.gateway';
import { CacheService } from '../../common/cache/cache.service';

@Module({
  controllers: [NocController],
  providers: [NocService, NocGateway, CacheService],
  exports: [NocService],
})
export class NocModule {}
