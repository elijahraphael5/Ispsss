import { Test } from '@nestjs/testing';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { SupportClientService } from './support-client.service';

describe('CustomerController', () => {
  let controller: CustomerController;
  const service = {
    getDashboard: jest.fn(),
    getAnalytics: jest.fn(),
    handleSubscriptionAction: jest.fn(),
    getInvoices: jest.fn(),
    getPayments: jest.fn(),
    getReceipts: jest.fn(),
    getTickets: jest.fn(),
    getTicket: jest.fn(),
    replyTicket: jest.fn(),
  };
  const support = { createCustomerTicket: jest.fn() };
  const req = () => ({ user: { id: 'u1' }, headers: { authorization: 'Bearer tok' } });

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomerController],
      providers: [
        { provide: CustomerService, useValue: service },
        { provide: SupportClientService, useValue: support },
      ],
    }).compile();
    controller = moduleRef.get(CustomerController);
  });

  it('dashboard delegates to service', async () => {
    service.getDashboard.mockResolvedValue({ ok: true });
    expect(await controller.dashboard(req() as any)).toEqual({ ok: true });
    expect(service.getDashboard).toHaveBeenCalledWith('u1');
  });

  it('analytics delegates to service', async () => {
    service.getAnalytics.mockResolvedValue({ trend: [] });
    expect(await controller.analytics(req() as any)).toEqual({ trend: [] });
  });

  it('subscription/action delegates to service', async () => {
    service.handleSubscriptionAction.mockResolvedValue({ message: 'done' });
    const body = { action: 'renew', planId: 'p1', reference: 'r1' };
    expect(await controller.subscriptionAction(req() as any, body)).toEqual({ message: 'done' });
    expect(service.handleSubscriptionAction).toHaveBeenCalledWith('u1', body);
  });

  it.each([
    ['invoices', 'getInvoices'],
    ['payments', 'getPayments'],
    ['receipts', 'getReceipts'],
  ] as Array<[string, string]>)('%s delegates to service', async (name, serviceMethod) => {
    (service as any)[serviceMethod].mockResolvedValue([{ id: 1 }]);
    expect(await (controller as any)[name](req() as any)).toEqual([{ id: 1 }]);
  });

  it('listTickets delegates to service', async () => {
    service.getTickets.mockResolvedValue([{ id: 't1' }]);
    expect(await controller.listTickets(req() as any)).toEqual([{ id: 't1' }]);
  });

  it('getTicket delegates to service', async () => {
    service.getTicket.mockResolvedValue({ id: 't1' });
    expect(await controller.getTicket(req() as any, 't1')).toEqual({ id: 't1' });
  });

  it('createTicket delegates to support client with auth header', async () => {
    support.createCustomerTicket.mockResolvedValue({ id: 't2' });
    const body = { subject: 'Slow internet', priority: 'HIGH' };
    expect(await controller.createTicket(req() as any, body)).toEqual({ id: 't2' });
    expect(support.createCustomerTicket).toHaveBeenCalledWith('u1', 'Bearer tok', body);
  });

  it('replyTicket delegates to service', async () => {
    service.replyTicket.mockResolvedValue({ id: 'c1' });
    expect(await controller.replyTicket(req() as any, 't1', { message: 'hi' })).toEqual({ id: 'c1' });
  });
});