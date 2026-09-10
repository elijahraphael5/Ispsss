import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import * as http from 'http';
import * as express from 'express';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ServiceProxyMiddleware } from './gateway/service-proxy.middleware';
import { PrismaService } from './common/prisma/prisma.service';
import { createLogger, withRequestId, assertProdEnv } from '@isp/logger';
import * as Sentry from '@sentry/node';
import { makeMetricsMiddleware, recordHttpRequest } from '@isp/metrics';
import { HealthService, makeLivenessHandler, makeReadinessHandler } from '@isp/health';
import { SlidingWindowRateLimiter, MemoryRateLimitStore, RedisRateLimitStore, RateLimitRule, envLimit } from '@isp/rate-limit';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';

const WEBHOOK_PATHS = ['/api/v1/payments/webhook/'];

function setupSocketProxy(server: http.Server) {
  const target = new URL(process.env.SUPPORT_SERVICE_URL ?? 'http://localhost:4104');

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    if (!url.startsWith('/socket.io')) {
      socket.destroy();
      return;
    }

    const proxyReq = http.request({
      hostname: target.hostname,
      port: target.port,
      path: url,
      method: 'GET',
      headers: {
        ...req.headers,
        host: target.host,
        connection: 'Upgrade',
        upgrade: 'websocket',
      },
    });

    proxyReq.on('upgrade', (res, upstreamSocket, upstreamHead) => {
      const statusLine = `HTTP/1.1 ${res.statusCode ?? 101} Switching Protocols\r\n`;
      const headerLines = Object.entries(res.headers)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`)
        .join('');
      socket.write(statusLine + headerLines + '\r\n');
      if (upstreamHead && upstreamHead.length) socket.write(upstreamHead);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
      socket.on('close', () => upstreamSocket.destroy());
      upstreamSocket.on('close', () => socket.destroy());
    });
    proxyReq.on('response', (res) => {
      res.resume();
    });
    proxyReq.on('error', () => {
      socket.destroy();
    });
    proxyReq.end();
  });
}

async function bootstrap() {
  assertProdEnv([
    { name: 'JWT_ACCESS_SECRET', forbidden: 'change-me' },
    { name: 'DATABASE_URL', forbidden: 'change_me' }
  ]);
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    });
  }
  const app = await NestFactory.create(AppModule, {
    // The Paystack webhook must be forwarded byte-for-byte to payments-service
    // so its HMAC signature stays valid — skip body parsing for that path and
    // let the proxy pipe the raw stream. JSON/urlencoded parsing is applied
    // manually for everything else.
    bodyParser: false,
    cors: {
      origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
        const allowed = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:3001')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const ok = !origin || allowed.includes(origin);
        cb(null, ok);
      },
      credentials: true,
    },
  });

  const logger = createLogger();
  const health = new HealthService([
    {
      name: 'database',
      check: async () => {
        const prisma = app.get(PrismaService);
        await prisma.$queryRaw`SELECT 1`;
      },
    },
  ]);
  const redisUrl = process.env.REDIS_URL ?? 'none';
  const redisClient = redisUrl === 'none' ? null : new Redis(redisUrl);

  const limiter = new SlidingWindowRateLimiter(
    redisClient ? new RedisRateLimitStore(redisClient) : new MemoryRateLimitStore(),
  );
  // JWT verifier for rate-limit keying — the same secret every backend verifies
  // against, so spoofed `sub` claims can't split buckets.
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET ?? 'change-me' });
  const mutationTier = (): RateLimitRule => ({ limit: envLimit('RATE_LIMIT_MUTATION_PER_MIN', 120), windowMs: 60_000 });
  const readTier = (): RateLimitRule => ({ limit: envLimit('RATE_LIMIT_READ_PER_MIN', 600), windowMs: 60_000 });
  const globalTier = (): RateLimitRule => ({ limit: envLimit('RATE_LIMIT_GLOBAL_PER_MIN', 1200), windowMs: 60_000 });
  const tierFor = (req: Request): RateLimitRule => {
    if (req.method !== 'GET') return mutationTier();
    return readTier();
  };
  // Authenticated requests are keyed per USER (fair across NAT'd offices where
  // many staff share one public IP); unauthenticated stay per-IP. The per-IP
  // global bucket below still caps any single IP overall.
  const userKey = async (req: Request): Promise<string | null> => {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) return null;
    try {
      const payload: any = await jwt.verifyAsync(auth.slice(7));
      return payload?.sub ? `user:${payload.sub}` : null;
    } catch {
      return null;
    }
  };

  app.use(helmet());
  app.use(cookieParser());
  // Manual body parsing for everything except signature-carrying webhook paths
  // (those are piped raw through ServiceProxyMiddleware).
  const jsonParser = express.json();
  const urlencodedParser = express.urlencoded({ extended: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (WEBHOOK_PATHS.some((p) => req.path.startsWith(p))) return next();
    const contentType = req.headers['content-type'] ?? '';
    if (contentType.includes('application/json')) {
      jsonParser(req, res, next);
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      urlencodedParser(req, res, next);
    } else {
      next();
    }
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
    (req as any).requestId = requestId;
    res.setHeader('x-request-id', requestId);
    const start = Date.now();
    withRequestId(requestId, () => {
      res.on('finish', () => {
        recordHttpRequest({ method: req.method, path: req.path, status: res.statusCode }, Date.now() - start);
      });
      next();
    });
  });
  app.use('/metrics', makeMetricsMiddleware() as any);
  app.use('/healthz', makeLivenessHandler(health) as any);
  app.use('/readyz', makeReadinessHandler(health) as any);
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    // Only honor X-Forwarded-For when explicitly behind a trusted proxy,
    // otherwise clients can spoof it to bypass IP rate limiting.
    const trustProxy = process.env.TRUST_PROXY === 'true';
    const ip = (trustProxy
      ? ((req.headers['x-forwarded-for'] as string) ?? req.ip ?? 'unknown')
      : (req.ip ?? 'unknown')
    ).split(',')[0].trim();
    const result = await limiter.consume(`${(await userKey(req)) ?? `ip:${ip}`}`, tierFor(req));
    const globalResult = await limiter.consume(`ip:${ip}`, globalTier());
    if (!result.allowed || !globalResult.allowed) {
      const retryAfterMs = Math.max(result.retryAfterMs, globalResult.retryAfterMs);
      res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      res.status(429).json({ statusCode: 429, message: 'Too many requests' });
      return;
    }
    next();
  });
  app.use(app.get(ServiceProxyMiddleware).use.bind(app.get(ServiceProxyMiddleware)));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.APP_PORT ?? 4000;
  await app.listen(port);
  setupSocketProxy(app.getHttpServer());
  logger.info({ port, redisUrl }, 'API gateway listening');
}
bootstrap();