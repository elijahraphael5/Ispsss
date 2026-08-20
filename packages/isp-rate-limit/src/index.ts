export interface RateLimitStore {
  zremrangebyscore(key: string, min: number, max: number): Promise<void>;
  zcard(key: string): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<void>;
  pexpire(key: string, ms: number): Promise<void>;
  zrangeWithScores(key: string, start: number, stop: number): Promise<Array<{ score: number; value: string }>>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, Array<{ score: number; value: string }>>();

  async zremrangebyscore(key: string, min: number, max: number): Promise<void> {
    const entries = this.store.get(key);
    if (!entries) return;
    this.store.set(key, entries.filter((e) => e.score < min || e.score > max));
    if (this.store.get(key)!.length === 0) this.store.delete(key);
  }

  async zcard(key: string): Promise<number> {
    return this.store.get(key)?.length ?? 0;
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    const entries = this.store.get(key) ?? [];
    entries.push({ score, value: member });
    entries.sort((a, b) => a.score - b.score);
    this.store.set(key, entries);
  }

  async pexpire(key: string, _ms: number): Promise<void> {
    // memory store is cleaned lazily by zremrangebyscore during consume
    if (!this.store.has(key)) return;
  }

  async zrangeWithScores(key: string, start: number, stop: number): Promise<Array<{ score: number; value: string }>> {
    const entries = this.store.get(key) ?? [];
    return entries.slice(start, stop === -1 ? undefined : stop + 1);
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  private readonly redis: import('ioredis').Redis;

  constructor(redis: import('ioredis').Redis) {
    this.redis = redis;
  }

  private key(k: string): string {
    return `ratelimit:${k}`;
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<void> {
    await this.redis.zremrangebyscore(this.key(key), min, max);
  }

  async zcard(key: string): Promise<number> {
    return this.redis.zcard(this.key(key));
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.redis.zadd(this.key(key), score, member);
  }

  async pexpire(key: string, ms: number): Promise<void> {
    await this.redis.pexpire(this.key(key), ms);
  }

  async zrangeWithScores(key: string, start: number, stop: number): Promise<Array<{ score: number; value: string }>> {
    const raw = await this.redis.zrange(this.key(key), start, stop, 'WITHSCORES');
    const out: Array<{ score: number; value: string }> = [];
    for (let i = 0; i < raw.length; i += 2) out.push({ value: raw[i], score: Number(raw[i + 1]) });
    return out;
  }
}

export interface ConsumeResult {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
}

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export class SlidingWindowRateLimiter {
  private readonly store: RateLimitStore;
  private readonly now: () => number;

  constructor(
    store: RateLimitStore,
    now: () => number = Date.now,
  ) {
    this.store = store;
    this.now = now;
  }

  async consume(key: string, rule: RateLimitRule): Promise<ConsumeResult> {
    const nowMs = this.now();
    const windowStart = nowMs - rule.windowMs;

    await this.store.zremrangebyscore(key, 0, windowStart);
    const count = await this.store.zcard(key);

    if (count >= rule.limit) {
      const oldest = await this.store.zrangeWithScores(key, 0, 0);
      const oldestTs = oldest[0]?.score ?? nowMs;
      const retryAfterMs = Math.max(0, oldestTs + rule.windowMs - nowMs);
      await this.store.pexpire(key, rule.windowMs);
      return { allowed: false, retryAfterMs, remaining: 0 };
    }

    await this.store.zadd(key, nowMs, `${nowMs}:${Math.random().toString(36).slice(2, 8)}`);
    await this.store.pexpire(key, rule.windowMs);
    return { allowed: true, retryAfterMs: 0, remaining: rule.limit - count - 1 };
  }
}

/** Shared tier presets — every service imports these rather than inventing its own numbers. */
export const DEFAULT_TIERS = {
  auth: { limit: 5, windowMs: 60_000 },
  authDaily: { limit: 20, windowMs: 3_600_000 },
  webhook: { limit: 100, windowMs: 60_000 },
  mutation: { limit: 60, windowMs: 60_000 },
  read: { limit: 300, windowMs: 60_000 },
  globalPerIp: { limit: 600, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;