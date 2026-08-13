import { Controller, Post, Get, Query, Req, Res } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class WebhookController {
  constructor(private readonly service: PaymentsService) {}

  @Post('webhook/paysorta')
  async paysortaWebhook(@Req() req: any) {
    return this.service.handlePaysortaWebhook(req.body);
  }

  @Get('paysorta/callback')
  async paysortaCallback(@Query() query: any, @Res() res: any) {
    const result = await this.service.handlePaysortaWebhook(query);
    const status = query.status === 'success' || result?.status === 'SUCCESSFUL' ? 'success' : 'failed';
    res.redirect(`${process.env.CUSTOMER_URL ?? 'http://localhost:3001'}/payment/callback?status=${status}`);
  }
}
