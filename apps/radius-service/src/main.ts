import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { PrismaService } from './common/prisma/prisma.service';
import { createLogger, withRequestId, assertProdEnv } from '@isp/logger';
import { makeMetricsMiddleware, recordHttpRequest } from '@isp/metrics';
import { HealthService, makeLivenessHandler, makeReadinessHandler } from '@isp/health';
import { SlidingWindowRateLimiter, MemoryRateLimitStore, DEFAULT_TIERS, RateLimitRule } from '@isp/rate-limit';

async function bootstrap() {
  assertProdEnv([
    { name: 'JWT_ACCESS_SECRET', forbidden: 'change-me' },
    { name: 'DATABASE_URL', forbidden: 'change_me' },
    { name: 'WEBHOOK_SERVICE_TOKEN' },
    { name: 'RADIUS_SHARED_SECRET', forbidden: 'testing123' },
    { name: 'RADIUS_DEFAULT_PASSWORD', forbidden: 'ChangeMe1!' },
    { name: 'RADIUS_DB_PASSWORD', forbidden: 'radiuspw' }
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

  const limiter = new SlidingWindowRateLimiter(new MemoryRateLimitStore());
  const tierFor = (req: Request): RateLimitRule => {
    if (req.method !== 'GET') return DEFAULT_TIERS.mutation;
    return DEFAULT_TIERS.read;
  };

  app.use(helmet());
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
    // Internal machine-to-machine routes are authenticated by WEBHOOK_SERVICE_TOKEN,
    // not rate-limited (bulk operations like import-activation would trip the limit).
    if (req.path.startsWith('/api/v1/internal/')) return next();
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

  const port = process.env.APP_PORT ?? 4106;
  await app.listen(port);
  logger.info({ port, redisUrl }, 'radius-service listening');
}
void bootstrap();