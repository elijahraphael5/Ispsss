import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PdfService } from './pdf.service';

@Module({
  controllers: [BillingController],
  providers: [BillingService, PdfService],
  exports: [BillingService],
})
export class BillingModule {}
