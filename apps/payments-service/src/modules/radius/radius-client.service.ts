import { Injectable, Logger } from '@nestjs/common';

/**
 * Fire-and-forget client for radius-service internal endpoints.
 * Called after payments/billing state transitions; failures are logged and
 * never propagated (the transition itself is already committed).
 */
@Injectable()
export class RadiusClientService {
  private readonly logger = new Logger(RadiusClientService.name);

  private get baseUrl(): string {
    return process.env.RADIUS_SERVICE_URL ?? 'http://localhost:4106';
  }

  private async post(path: string): Promise<void> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = process.env.WEBHOOK_SERVICE_TOKEN;
    if (token) headers['x-webhook-token'] = token;

    const res = await fetch(`${this.baseUrl}/api/v1/internal/radius${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`radius-service ${path} -> ${res.status}`);
    }
  }

  async activate(customerId: string): Promise<void> {
    try {
      await this.post(`/customers/${customerId}/activate`);
      this.logger.log(`RADIUS activate sent for customer ${customerId}`);
    } catch (err: any) {
      this.logger.warn(`RADIUS activate for ${customerId} failed: ${err?.message ?? err}`);
    }
  }

  async deactivate(customerId: string): Promise<void> {
    try {
      await this.post(`/customers/${customerId}/deactivate`);
      this.logger.log(`RADIUS deactivate sent for customer ${customerId}`);
    } catch (err: any) {
      this.logger.warn(`RADIUS deactivate for ${customerId} failed: ${err?.message ?? err}`);
    }
  }
}