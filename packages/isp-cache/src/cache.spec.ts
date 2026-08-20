import { CacheService, MemoryCacheClient, NoopCacheClient } from './index';

describe('@isp/cache — MemoryCacheClient', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('roundtrips values and deletes keys', async () => {
    const c = new MemoryCacheClient();
    await c.set('k', 'v');
    expect(await c.get('k')).toBe('v');
    await c.del('k');
    expect(await c.get('k')).toBeNull();
  });

  it('expires values after ttl', async () => {
    const c = new MemoryCacheClient();
    await c.set('k', 'v', 10);
    expect(await c.get('k')).toBe('v');
    jest.advanceTimersByTime(10_000);
    expect(await c.get('k')).toBeNull();
  });

  it('does not expire values without ttl', async () => {
    const c = new MemoryCacheClient();
    await c.set('k', 'v');
    jest.advanceTimersByTime(60 * 60 * 1000);
    expect(await c.get('k')).toBe('v');
  });
});

describe('@isp/cache — CacheService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('disabled mode (null client): never hits cache, always loads', async () => {
    const svc = new CacheService(null);
    expect(svc.enabled).toBe(false);
    expect(await svc.get('k')).toBeNull();
    await svc.set('k', 'v');
    expect(await svc.get('k')).toBeNull();
    const loader = jest.fn(async () => 'loaded');
    expect(await svc.withCache('k', { ttlSeconds: 60 }, loader)).toBe('loaded');
    expect(await svc.withCache('k', { ttlSeconds: 60 }, loader)).toBe('loaded');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('withCache hits cache on second call (loader called once)', async () => {
    const svc = new CacheService(new MemoryCacheClient());
    const loader = jest.fn(async () => ({ a: 1 }));
    const first = await svc.withCache('k', { ttlSeconds: 60 }, loader);
    const second = await svc.withCache('k', { ttlSeconds: 60 }, loader);
    expect(first).toEqual({ a: 1 });
    expect(second).toEqual({ a: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('withCache respects ttl and reloads after expiry', async () => {
    const svc = new CacheService(new MemoryCacheClient());
    const loader = jest.fn(async () => Math.random());
    await svc.withCache('k', { ttlSeconds: 5 }, loader);
    jest.advanceTimersByTime(5_000);
    await svc.withCache('k', { ttlSeconds: 5 }, loader);
    await svc.withCache('k', { ttlSeconds: 5 }, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('withCache propagates loader errors but survives cache write failures', async () => {
    const failing = new MemoryCacheClient();
    failing.set = async () => {
      throw new Error('redis down');
    };
    const svc = new CacheService(failing);
    const loader = jest.fn(async () => 'data');
    await expect(svc.withCache('k', { ttlSeconds: 5 }, loader)).resolves.toBe('data');

    const throwing = jest.fn(async () => {
      throw new Error('boom');
    });
    await expect(svc.withCache('k2', { ttlSeconds: 5 }, throwing)).rejects.toThrow('boom');
  });

  it('get with deserialize returns parsed value and null on parse error', async () => {
    const svc = new CacheService(new MemoryCacheClient());
    await svc.set('json', { n: 1 });
    expect(await svc.get<{ n: number }>('json', JSON.parse)).toEqual({ n: 1 });
    await svc.set('bad', 'not-json');
    expect(await svc.get('bad', JSON.parse)).toBeNull();
  });

  it('del invalidates keys', async () => {
    const svc = new CacheService(new MemoryCacheClient());
    await svc.set('a', 1);
    await svc.set('b', 2);
    await svc.del('a', 'b');
    expect(await svc.get('a')).toBeNull();
    expect(await svc.get('b')).toBeNull();
  });

  it('NoopCacheClient behaves like a working-but-empty cache', async () => {
    const c = new NoopCacheClient();
    await c.set('k', 'v', 60);
    await c.del('k');
    expect(await c.get('k')).toBeNull();
    const svc = new CacheService(c);
    expect(svc.enabled).toBe(true);
  });
});