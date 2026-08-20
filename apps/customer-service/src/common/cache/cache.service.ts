import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: any, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  invalidatePattern(pattern: string): Promise<void>;
}

class NoopCache implements CacheStore {
  async get<T>(): Promise<T | null> { return null; }
  async set() {}
  async del() {}
  async invalidatePattern() {}
}

class RedisCache implements CacheStore {
  private readonly redis: Redis;
  private readonly logger = new Logger('RedisCache');

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      keyPrefix: 'cache:',
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });
    this.redis.on('error', (err) => this.logger.warn(`Redis cache error: ${err.message}`));
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds = 300): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`Redis set failed: ${(err as Error).message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {}
  }

  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const stream = this.redis.scanStream({ match: `cache:${pattern}`, count: 100 });
      for await (const keys of stream) {
        if (keys.length) await this.redis.del(...keys);
      }
    } catch {}
  }
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly store: CacheStore;

  constructor() {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    if (redisUrl === 'none') {
      this.store = new NoopCache();
      this.logger.warn('Redis disabled (REDIS_URL=none), cache is a no-op');
    } else {
      this.store = new RedisCache(redisUrl);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    return this.store.get<T>(key);
  }

  async set(key: string, value: any, ttlSeconds = 300): Promise<void> {
    return this.store.set(key, value, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    return this.store.del(key);
  }

  async invalidatePattern(pattern: string): Promise<void> {
    return this.store.invalidatePattern(pattern);
  }
}