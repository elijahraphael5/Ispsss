import { Test } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { RadiusController } from './radius.controller';
import { RadiusInternalController } from './radius.internal.controller';
import { RadiusService } from './radius.service';
import { RadiusMutationGuard } from './radius-mutation.guard';

describe('RadiusControllers', () => {
  let controller: RadiusController;
  let internal: RadiusInternalController;
  const radius = {
    activate: jest.fn().mockResolvedValue({ activated: true }),
    deactivate: jest.fn().mockResolvedValue({ deactivated: true }),
    changePlan: jest.fn().mockResolvedValue({ rateLimit: '10M/10M' }),
    getUsage: jest.fn().mockResolvedValue({ online: true }),
  };
  const limiter = { consume: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [RadiusController, RadiusInternalController],
      providers: [
        { provide: RadiusService, useValue: radius },
        { provide: 'RADIUS_LIMITER', useValue: limiter },
      ],
    })
      .overrideGuard(RadiusMutationGuard)
      .useValue({ canActivate: async () => true })
      .compile();
    controller = moduleRef.get(RadiusController);
    internal = moduleRef.get(RadiusInternalController);
  });

  it('delegates activate/deactivate/change-plan/usage to the service', async () => {
    await expect(controller.activate('c1')).resolves.toEqual({ activated: true });
    await expect(controller.deactivate('c1')).resolves.toEqual({ deactivated: true });
    await expect(controller.changePlan('c1', { rateLimit: '10M/10M' })).resolves.toMatchObject({ rateLimit: '10M/10M' });
    await expect(controller.usage('c1')).resolves.toMatchObject({ online: true });
    expect(radius.activate).toHaveBeenCalledWith('c1');
  });

  it('enforces the webhook token on internal endpoints when configured', async () => {
    process.env.WEBHOOK_SERVICE_TOKEN = 'wh-secret';
    let caught: unknown = null;
    try {
      await internal.activate('c1', {}, 'wrong');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    await expect(internal.activate('c1', {}, 'wh-secret')).resolves.toMatchObject({ activated: true });
    delete process.env.WEBHOOK_SERVICE_TOKEN;
  });

  it('skips the token check when WEBHOOK_SERVICE_TOKEN is unset', async () => {
    delete process.env.WEBHOOK_SERVICE_TOKEN;
    await expect(internal.deactivate('c1', undefined)).resolves.toMatchObject({ deactivated: true });
  });

  it('rejects mutations when the per-customer rate limit is exceeded', async () => {
    const guard = new RadiusMutationGuard(limiter as any);
    limiter.consume.mockResolvedValue({ allowed: false, retryAfterMs: 4200 });
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ params: { id: 'c1' } }) }),
    } as any;
    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
    expect(limiter.consume).toHaveBeenCalledWith('radius:customer:c1', { limit: 10, windowMs: 60_000 });
  });
});