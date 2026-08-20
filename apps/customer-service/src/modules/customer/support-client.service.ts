import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export interface CustomerTicketInput {
  subject: string;
  description?: string;
  category?: string;
  priority?: string;
}

@Injectable()
export class SupportClientService {
  private readonly logger = new Logger(SupportClientService.name);

  private get baseUrl(): string {
    return process.env.SUPPORT_SERVICE_URL ?? 'http://localhost:4104';
  }

  async createCustomerTicket(userId: string, authHeader: string | undefined, data: CustomerTicketInput) {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/chat/internal/customer-tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...(process.env.WEBHOOK_SERVICE_TOKEN
            ? { 'x-webhook-token': process.env.WEBHOOK_SERVICE_TOKEN }
            : {}),
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`Support service error ${res.status}: ${text}`);
        throw new ServiceUnavailableException('Support service unavailable');
      }
      return res.json();
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`Support service unreachable: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Support service unavailable');
    }
  }
}