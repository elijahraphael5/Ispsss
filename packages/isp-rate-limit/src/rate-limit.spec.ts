import { MemoryRateLimitStore, SlidingWindowRateLimiter, DEFAULT_TIERS } from './index';

describe('@isp/rate-limit — sliding window', () => {
  let clock: number;
  let limiter: SlidingWindowRateLimiter;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
    limiter = new SlidingWindowRateLimiter(new MemoryRateLimitStore(), now);
  });

  it('allows requests under the limit and decrements remaining', async () => {
    const r1 = await limiter.consume('ip:1.2.3.4', DEFAULT_TIERS.auth);
    const r2 = await limiter.consume('ip:1.2.3.4', DEFAULT_TIERS.auth);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(4);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(3);
  });

  it('blocks once the limit is reached and reports retryAfterMs', async () => {
    for (let i = 0; i < 5; i++) await limiter.consume('k', DEFAULT_TIERS.auth);
    const blocked = await limiter.consume('k', DEFAULT_TIERS.auth);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(DEFAULT_TIERS.auth.windowMs);
  });

  it('retryAfterMs is exactly the remaining life of the oldest entry', async () => {
    await limiter.consume('k', DEFAULT_TIERS.auth); // at t=0
    clock += 10_000; // oldest entry now expires in 50_000ms
    for (let i = 0; i < 4; i++) await limiter.consume('k', DEFAULT_TIERS.auth);
    const blocked = await limiter.consume('k', DEFAULT_TIERS.auth);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(50_000);
  });

  it('prunes expired entries so requests are allowed again after the window', async () => {
    for (let i = 0; i < 5; i++) await limiter.consume('k', DEFAULT_TIERS.auth);
    clock += DEFAULT_TIERS.auth.windowMs + 1;
    const r = await limiter.consume('k', DEFAULT_TIERS.auth);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(4);
  });

  it('allows one more request as soon as the oldest entry slides out', async () => {
    const BASE = 1_000_000;
    const window = DEFAULT_TIERS.auth.windowMs;
    const times = [0, 10_000, 20_000, 30_000, 40_000];
    for (const t of times) {
      clock = BASE + t;
      await limiter.consume('k', DEFAULT_TIERS.auth);
    }
    // entries at BASE+0..BASE+40000; the oldest expires at BASE+60000
    clock = BASE + 60_001;
    const r = await limiter.consume('k', DEFAULT_TIERS.auth);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(0);
    const blocked = await limiter.consume('k', DEFAULT_TIERS.auth);
    expect(blocked.allowed).toBe(false);
  });

  it('isolates keys from each other', async () => {
    await limiter.consume('user:a', DEFAULT_TIERS.auth);
    for (let i = 0; i < 5; i++) await limiter.consume('user:b', DEFAULT_TIERS.auth);
    const a = await limiter.consume('user:a', DEFAULT_TIERS.auth);
    const b = await limiter.consume('user:b', DEFAULT_TIERS.auth);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(false);
  });

  it('enforces different rules per key (auth vs read tiers)', async () => {
    for (let i = 0; i < DEFAULT_TIERS.auth.limit; i++) await limiter.consume('ip:x', DEFAULT_TIERS.auth);
    expect((await limiter.consume('ip:x', DEFAULT_TIERS.auth)).allowed).toBe(false);
    expect((await limiter.consume('ip:x', DEFAULT_TIERS.read)).allowed).toBe(true);
  });

  it('DEFAULT_TIERS exposes the agreed limits', () => {
    expect(DEFAULT_TIERS.auth.limit).toBe(5);
    expect(DEFAULT_TIERS.auth.windowMs).toBe(60_000);
    expect(DEFAULT_TIERS.authDaily.limit).toBe(20);
    expect(DEFAULT_TIERS.webhook.limit).toBe(100);
    expect(DEFAULT_TIERS.mutation.limit).toBe(60);
    expect(DEFAULT_TIERS.read.limit).toBe(300);
    expect(DEFAULT_TIERS.globalPerIp.limit).toBe(600);
  });
});