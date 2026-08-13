import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PaymentsController } from './payments.controller';
import { WebhookController } from './webhook.controller';
import { PaymentsService } from './payments.service';
import { PaystackProvider } from './providers/paystack.provider';

@Module({
  imports: [BillingModule],
  controllers: [PaymentsController, WebhookController],
  providers: [PaymentsService, PaystackProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
