export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
}

export class NoopCacheClient implements CacheClient {
  async get(_key: string): Promise<string | null> {
    return null;
  }
  async set(_key: string, _value: string, _ttlSeconds?: number): Promise<void> {
    // no-op
  }
  async del(..._keys: string[]): Promise<void> {
    // no-op
  }
}

export class MemoryCacheClient implements CacheClient {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  }

  async del(...keys: string[]): Promise<void> {
    for (const key of keys) this.store.delete(key);
  }

  size(): number {
    return this.store.size;
  }
}

export class CacheService {
  private readonly client: CacheClient | null;

  constructor(client: CacheClient | null) {
    this.client = client;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async get<T = string>(key: string, deserialize?: (raw: string) => T): Promise<T | null> {
    if (!this.client) return null;
    const raw = await this.client.get(key);
    if (raw === null) return null;
    if (!deserialize) return raw as unknown as T;
    try {
      return deserialize(raw);
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    await this.client.set(key, raw, ttlSeconds);
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.client) return;
    await this.client.del(...keys);
  }

  async withCache<T>(
    key: string,
    opts: { ttlSeconds: number; deserialize?: (raw: string) => T },
    loader: () => Promise<T>,
  ): Promise<T> {
    if (!this.client) return loader();
    const hit = await this.get<string>(key);
    if (hit !== null) {
      if (opts.deserialize) return opts.deserialize(hit);
      try {
        return JSON.parse(hit) as T;
      } catch {
        return hit as unknown as T;
      }
    }
    const value = await loader();
    try {
      await this.set(key, value, opts.ttlSeconds);
    } catch {
      // cache write failure must never fail the request
    }
    return value;
  }
}

export class RedisCacheClient implements CacheClient {
  private readonly redis: import('ioredis').Redis;

  constructor(redis: import('ioredis').Redis) {
    this.redis = redis;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) await this.redis.set(key, value, 'EX', ttlSeconds);
    else await this.redis.set(key, value);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.redis.del(...keys);
  }
}