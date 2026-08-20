import { Test } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { SupportClientService } from './support-client.service';

describe('SupportClientService', () => {
  let service: SupportClientService;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    process.env.SUPPORT_SERVICE_URL = 'http://support.internal:4104';
    delete process.env.WEBHOOK_SERVICE_TOKEN;
    const moduleRef = await Test.createTestingModule({
      providers: [SupportClientService],
    }).compile();
    service = moduleRef.get(SupportClientService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('creates a customer ticket through the support internal endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 't1' }),
    }) as any;

    const result = await service.createCustomerTicket('u1', 'Bearer tok', { subject: 'S', priority: 'HIGH' });
    expect(result).toEqual({ id: 't1' });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://support.internal:4104/api/v1/chat/internal/customer-tickets',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    );
  });

  it('adds webhook token header when configured', async () => {
    process.env.WEBHOOK_SERVICE_TOKEN = 'wh-token';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
    await service.createCustomerTicket('u1', undefined, { subject: 'S' });
    const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers;
    expect(headers['x-webhook-token']).toBe('wh-token');
  });

  it('throws ServiceUnavailableException when upstream errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }) as any;
    await expect(service.createCustomerTicket('u1', 't', { subject: 'S' })).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws ServiceUnavailableException when upstream is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    await expect(service.createCustomerTicket('u1', 't', { subject: 'S' })).rejects.toThrow(ServiceUnavailableException);
  });
});