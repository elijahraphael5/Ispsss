import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import * as http from 'http';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ServiceProxyMiddleware } from './gateway/service-proxy.middleware';
import { PrismaService } from './common/prisma/prisma.service';
import { createLogger, withRequestId, assertProdEnv } from '@isp/logger';
import { makeMetricsMiddleware, recordHttpRequest } from '@isp/metrics';
import { HealthService, makeLivenessHandler, makeReadinessHandler } from '@isp/health';
import { SlidingWindowRateLimiter, MemoryRateLimitStore, DEFAULT_TIERS, RateLimitRule } from '@isp/rate-limit';
import Redis from 'ioredis';

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
  const redisClient = redisUrl === 'none' ? null : new Redis(redisUrl);

  const limiter = new SlidingWindowRateLimiter(new MemoryRateLimitStore());
  const tierFor = (req: Request): RateLimitRule => {
    if (req.method !== 'GET') return DEFAULT_TIERS.mutation;
    return DEFAULT_TIERS.read;
  };

  app.use(helmet());
  app.use(cookieParser());
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
    const ip = ((req.headers['x-forwarded-for'] as string) ?? req.ip ?? 'unknown').split(',')[0].trim();
    const result = await limiter.consume(`ip:${ip}`, tierFor(req));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
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