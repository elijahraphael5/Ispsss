import { Injectable, Logger } from '@nestjs/common';
import { GatewayConfigService } from '../gateway-config.service';

interface FlutterwaveInitResponse {
  status: string;
  message: string;
  data: { link: string; tx_ref?: string };
}

interface FlutterwaveVerifyResponse {
  status: string;
  message: string;
  data: { status: string; tx_ref: string; amount: number; currency: string; flw_ref?: string; transaction_id?: number };
}

@Injectable()
export class FlutterwaveProvider {
  private readonly logger = new Logger(FlutterwaveProvider.name);
  private readonly baseUrl = 'https://api.flutterwave.com';

  constructor(private readonly gatewayKeys: GatewayConfigService) {}

  private async headers() {
    const key = await this.gatewayKeys.getFlutterwaveSecret();
    if (!key) this.logger.warn('Flutterwave secret key not configured (UI or FLUTTERWAVE_SECRET_KEY) — provider will fail');
    return {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
  }

  async initializeTransaction(params: {
    email: string;
    amountKobo: number;
    reference: string;
    callbackUrl?: string;
    metadata?: Record<string, any>;
  }): Promise<{ authorizationUrl: string; reference: string }> {
    const amountNaira = params.amountKobo / 100;
    const res = await fetch(`${this.baseUrl}/v3/payments`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        tx_ref: params.reference,
        amount: amountNaira,
        currency: 'NGN',
        redirect_url: params.callbackUrl,
        customer: { email: params.email },
        customizations: {
          title: 'ISP Payment',
          description: params.metadata?.invoiceId ? `Invoice ${params.metadata.invoiceId}` : 'Payment',
        },
        meta: params.metadata,
      }),
    });
    const body: FlutterwaveInitResponse = await res.json();
    if (body.status !== 'success' && !body.data?.link) throw new Error(`Flutterwave init failed: ${JSON.stringify(body)}`);
    return { authorizationUrl: body.data.link, reference: params.reference };
  }

  async verifyTransaction(reference: string): Promise<{ status: string; amountKobo: number; paidAt: string }> {
    // Flutterwave verify by tx_ref
    const res = await fetch(`${this.baseUrl}/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, {
      headers: await this.headers(),
    });
    const body: FlutterwaveVerifyResponse = await res.json();
    if (body.status !== 'success') throw new Error(`Flutterwave verify failed: ${JSON.stringify(body)}`);
    const amountKobo = Math.round(Number(body.data.amount) * 100);
    const status = body.data.status.toLowerCase() === 'successful' ? 'success' : body.data.status;
    // Flutterwave verify response does not always include paid_at; use now as fallback
    return { status, amountKobo, paidAt: new Date().toISOString() };
  }
}
