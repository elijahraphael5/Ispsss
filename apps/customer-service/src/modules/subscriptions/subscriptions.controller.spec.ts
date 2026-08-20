import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { MailService, WelcomeData } from '../mail/mail.service';

describe('SubscriptionsController', () => {
  let controller: SubscriptionsController;
  const service = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    listPlans: jest.fn(),
    createPlan: jest.fn(),
    updatePlan: jest.fn(),
    createSubscription: jest.fn(),
    updateSubscription: jest.fn(),
    removeSubscription: jest.fn(),
  };
  const mail = { sendWelcome: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [SubscriptionsController],
      providers: [
        { provide: SubscriptionsService, useValue: service },
        { provide: MailService, useValue: mail },
      ],
    }).compile();
    controller = moduleRef.get(SubscriptionsController);
  });

  it('findAll passes pagination params', async () => {
    service.findAll.mockResolvedValue({ data: [], total: 0 });
    await controller.findAll('10', '20', 'q', 'BUSINESS');
    expect(service.findAll).toHaveBeenCalledWith(10, 20, 'q', 'BUSINESS');
  });

  it('listPlans delegates', async () => {
    service.listPlans.mockResolvedValue([{ id: 'p1' }]);
    expect(await controller.listPlans()).toEqual([{ id: 'p1' }]);
  });

  it('createPlan delegates', async () => {
    service.createPlan.mockResolvedValue({ id: 'p1' });
    expect(await controller.createPlan({ name: 'X' })).toEqual({ id: 'p1' });
  });

  it('updatePlan delegates', async () => {
    service.updatePlan.mockResolvedValue({ id: 'p1' });
    expect(await controller.updatePlan('p1', { priceKobo: 1 })).toEqual({ id: 'p1' });
  });

  it('findOne delegates', async () => {
    service.findOne.mockResolvedValue({ id: 's1' });
    expect(await controller.findOne('s1')).toEqual({ id: 's1' });
  });

  it('create delegates', async () => {
    service.create.mockResolvedValue({ id: 's1' });
    expect(await controller.create({ userId: 'u1', type: 'RESIDENTIAL' })).toEqual({ id: 's1' });
  });

  it('update delegates', async () => {
    service.update.mockResolvedValue({ id: 's1' });
    expect(await controller.update('s1', { status: 'ACTIVE' })).toEqual({ id: 's1' });
  });

  it('suspend / unsuspend map to status updates', async () => {
    service.update.mockResolvedValue({ status: 'SUSPENDED' });
    await controller.suspend('s1');
    expect(service.update).toHaveBeenCalledWith('s1', { status: 'SUSPENDED' });
    await controller.unsuspend('s1');
    expect(service.update).toHaveBeenCalledWith('s1', { status: 'ACTIVE' });
  });

  it('remove delegates', async () => {
    service.remove.mockResolvedValue({ id: 's1' });
    expect(await controller.remove('s1')).toEqual({ id: 's1' });
  });

  it('createSubscription delegates', async () => {
    service.createSubscription.mockResolvedValue({ id: 'sub1' });
    const body = { planId: 'p1', autoRenew: true, expiresAt: new Date('2026-09-01') };
    expect(await controller.createSubscription('s1', body)).toEqual({ id: 'sub1' });
    expect(service.createSubscription).toHaveBeenCalledWith({ subscriberId: 's1', ...body });
  });

  it('sendWelcome sends the welcome email with plan data', async () => {
    service.findOne.mockResolvedValue({
      id: 's1',
      user: { email: 'a@b.co' },
      subscriptions: [{ plan: { name: 'Starter', speedMbps: 10, priceKobo: 100000, installationFeeKobo: 0 } }],
    });
    mail.sendWelcome.mockResolvedValue(undefined);
    expect(await controller.sendWelcome('s1', {})).toEqual({ message: 'Welcome email sent to a@b.co' });
    const data: WelcomeData = mail.sendWelcome.mock.calls[0][0];
    expect(data.email).toBe('a@b.co');
    expect(data.planName).toBe('Starter');
  });

  it('sendWelcome throws when no subscription exists', async () => {
    service.findOne.mockResolvedValue({ id: 's1', user: { email: 'a@b.co' }, subscriptions: [] });
    await expect(controller.sendWelcome('s1', {})).rejects.toThrow(NotFoundException);
  });

  it('updateSubscription delegates', async () => {
    service.updateSubscription.mockResolvedValue({ id: 'sub1' });
    expect(await controller.updateSubscription('sub1', { planId: 'p2' })).toEqual({ id: 'sub1' });
  });

  it('removeSubscription delegates', async () => {
    service.removeSubscription.mockResolvedValue({ id: 'sub1' });
    expect(await controller.removeSubscription('sub1')).toEqual({ id: 'sub1' });
  });
});