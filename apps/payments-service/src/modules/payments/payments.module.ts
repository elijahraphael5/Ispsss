import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { MailModule } from '../mail/mail.module';
import { RadiusClientService } from '../radius/radius-client.service';
import { PaymentsController } from './payments.controller';
import { WebhookController } from './webhook.controller';
import { PaymentsService } from './payments.service';
import { PaystackProvider } from './providers/paystack.provider';

@Module({
  imports: [BillingModule, MailModule],
  controllers: [PaymentsController, WebhookController],
  providers: [PaymentsService, PaystackProvider, RadiusClientService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
