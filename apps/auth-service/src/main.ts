import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { PrismaService } from './common/prisma/prisma.service';
import { createLogger, withRequestId, assertProdEnv } from '@isp/logger';
import { makeMetricsMiddleware, recordHttpRequest } from '@isp/metrics';
import { HealthService, makeLivenessHandler, makeReadinessHandler } from '@isp/health';
import { SlidingWindowRateLimiter, MemoryRateLimitStore, DEFAULT_TIERS, RateLimitRule } from '@isp/rate-limit';
import { CacheService, NoopCacheClient, RedisCacheClient } from '@isp/cache';
import Redis from 'ioredis';

async function bootstrap() {
  assertProdEnv([
    { name: 'JWT_ACCESS_SECRET', forbidden: 'change-me' },
    { name: 'DATABASE_URL', forbidden: 'change_me' },
    { name: 'FRONTEND_URL', forbidden: 'localhost' }
  ]);
  const app = await NestFactory.create(AppModule, {
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
  const cache = new CacheService(
    redisUrl === 'none' ? new NoopCacheClient() : new RedisCacheClient(new Redis(redisUrl)),
  );

  const limiter = new SlidingWindowRateLimiter(new MemoryRateLimitStore());
  const tierFor = (req: Request): RateLimitRule => {
    const path = req.path;
    if (path === '/api/v1/auth/login' || path === '/api/v1/auth/2fa/verify') return DEFAULT_TIERS.auth;
    if (path.includes('/auth/register') || path.includes('/auth/forgot-password') || path.includes('/auth/reset-password')) {
      return DEFAULT_TIERS.authDaily;
    }
    return DEFAULT_TIERS.globalPerIp;
  };

  app.use(helmet());
  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
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
    const ip = ((req.headers['x-forwarded-for'] as string) ?? req.ip ?? 'unknown').split(',')[0].trim();
    const result = await limiter.consume(`ip:${ip}`, tierFor(req));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      res.status(429).json({ statusCode: 429, message: 'Too many requests' });
      return;
    }
    next();
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.APP_PORT ?? 4101;
  await app.listen(port);
  logger.info({ port, redisUrl }, 'auth-service listening');
}
bootstrap();