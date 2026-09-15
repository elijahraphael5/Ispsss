import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PdfService } from './pdf.service';
import { CacheService } from '../../common/cache/cache.service';

@Module({
  controllers: [BillingController],
  providers: [BillingService, PdfService, CacheService],
  exports: [BillingService],
})
export class BillingModule {}
