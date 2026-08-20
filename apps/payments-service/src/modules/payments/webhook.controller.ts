import { Controller, Post, Req } from '@nestjs/common';
import { PaymentsService } from './payments.service';

/**
 * Public webhook endpoint — Paystack calls this server-side with an
 * x-paystack-signature header that is verified inside PaymentsService
 * (HMAC-SHA512 over the raw body using PAYSTACK_SECRET_KEY).
 */
@Controller('payments')
export class WebhookController {
  constructor(private readonly service: PaymentsService) {}

  @Post('webhook/paystack')
  async paystackWebhook(@Req() req: any) {
    return this.service.handlePaystackWebhook(req.body, req.headers['x-paystack-signature']);
  }
}