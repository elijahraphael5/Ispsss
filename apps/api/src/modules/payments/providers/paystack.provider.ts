import { Injectable, Logger } from '@nestjs/common';

interface PaystackInitResponse {
  status: boolean;
  data: { authorization_url: string; reference: string; access_code: string };
}

interface PaystackVerifyResponse {
  status: boolean;
  data: { status: string; reference: string; amount: number; paid_at: string };
}

@Injectable()
export class PaystackProvider {
  private readonly logger = new Logger(PaystackProvider.name);
  private readonly baseUrl = 'https://api.paystack.co';
  private readonly secretKey: string;

  constructor() {
    this.secretKey = process.env.PAYSTACK_SECRET_KEY ?? '';
    if (!this.secretKey) {
      this.logger.warn('PAYSTACK_SECRET_KEY not set — Paystack provider will fail');
    }
  }

  async initializeTransaction(params: {
    email: string;
    amountKobo: number;
    reference: string;
    callbackUrl?: string;
    metadata?: Record<string, any>;
  }): Promise<{ authorizationUrl: string; reference: string }> {
    const res = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        email: params.email,
        amount: params.amountKobo,
        reference: params.reference,
        callback_url: params.callbackUrl,
        metadata: params.metadata,
      }),
    });
    const body: PaystackInitResponse = await res.json();
    if (!body.status) throw new Error(`Paystack init failed: ${JSON.stringify(body)}`);
    return { authorizationUrl: body.data.authorization_url, reference: body.data.reference };
  }

  async verifyTransaction(reference: string): Promise<{ status: string; amountKobo: number; paidAt: string }> {
    const res = await fetch(`${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: this.headers(),
    });
    const body: PaystackVerifyResponse = await res.json();
    if (!body.status) throw new Error(`Paystack verify failed: ${JSON.stringify(body)}`);
    return { status: body.data.status, amountKobo: body.data.amount, paidAt: body.data.paid_at };
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }
}
