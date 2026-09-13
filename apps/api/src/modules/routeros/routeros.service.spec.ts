import { Test } from '@nestjs/testing';
import { RequestTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import { RouterOsService } from './routeros.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('RouterOsService circuit breaker', () => {
  let service: RouterOsService;
  let fetchMock: jest.SpyInstance;

  const device = {
    id: 'dev-1',
    ipAddress: '10.9.9.9',
    routerosPort: 80,
    routerosUsername: 'admin',
    routerosPassword: 'pw',
  };
  const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RouterOsService,
        { provide: PrismaService, useValue: { networkDevice: { findUnique: jest.fn().mockResolvedValue(device) } } },
      ],
    }).compile();
    service = moduleRef.get(RouterOsService);
    fetchMock = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails fast after three consecutive failures instead of waiting every call', async () => {
    fetchMock.mockRejectedValue(timeout());

    await expect(service.getQueues('dev-1')).rejects.toBeInstanceOf(RequestTimeoutException);
    await expect(service.getQueues('dev-1')).rejects.toBeInstanceOf(RequestTimeoutException);
    await expect(service.getQueues('dev-1')).rejects.toBeInstanceOf(RequestTimeoutException);

    const callsBefore = fetchMock.mock.calls.length;
    await expect(service.getQueues('dev-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('resets the failure count once the device responds', async () => {
    fetchMock
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] } as any)
      .mockRejectedValue(timeout());

    await expect(service.getQueues('dev-1')).rejects.toBeInstanceOf(RequestTimeoutException);
    await expect(service.getQueues('dev-1')).rejects.toBeInstanceOf(RequestTimeoutException);
    await expect(service.getQueues('dev-1')).resolves.toEqual([]);

    // Counter restarted: three more failures must still hit the device.
    await expect(service.getQueues('dev-1')).rejects.toBeInstanceOf(RequestTimeoutException);
    await expect(service.getQueues('dev-1')).rejects.toBeInstanceOf(RequestTimeoutException);
    await expect(service.getQueues('dev-1')).rejects.toBeInstanceOf(RequestTimeoutException);
    await expect(service.getQueues('dev-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
