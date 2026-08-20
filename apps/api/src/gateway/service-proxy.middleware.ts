import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as http from 'http';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

@Injectable()
export class ServiceProxyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ServiceProxyMiddleware.name);

  private readonly routes: Array<{ prefix: string; base: string }> = [
    { prefix: '/api/v1/auth', base: process.env.AUTH_SERVICE_URL ?? 'http://localhost:4101' },
    { prefix: '/api/v1/payments', base: process.env.PAYMENTS_SERVICE_URL ?? 'http://localhost:4102' },
    { prefix: '/api/v1/billing', base: process.env.BILLING_SERVICE_URL ?? 'http://localhost:4103' },
    { prefix: '/api/v1/chat', base: process.env.SUPPORT_SERVICE_URL ?? 'http://localhost:4104' },
    { prefix: '/api/v1/support', base: process.env.SUPPORT_SERVICE_URL ?? 'http://localhost:4104' },
    { prefix: '/socket.io', base: process.env.SUPPORT_SERVICE_URL ?? 'http://localhost:4104' },
    { prefix: '/api/v1/customer', base: process.env.CUSTOMER_SERVICE_URL ?? 'http://localhost:4105' },
    { prefix: '/api/v1/subscriptions', base: process.env.CUSTOMER_SERVICE_URL ?? 'http://localhost:4105' },
    { prefix: '/api/v1/crm', base: process.env.CUSTOMER_SERVICE_URL ?? 'http://localhost:4105' },
    { prefix: '/api/v1/customers', base: process.env.RADIUS_SERVICE_URL ?? 'http://localhost:4106' },
    { prefix: '/api/v1/radius', base: process.env.RADIUS_SERVICE_URL ?? 'http://localhost:4106' },
  ];

  use(req: Request, res: Response, next: NextFunction) {
    const pathname = req.path;
    const route = this.routes.find(
      (r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'),
    );
    if (!route) return next();

    let body: Buffer | null = null;
    if (req.body !== undefined && typeof req.body === 'object') {
      body = Buffer.from(JSON.stringify(req.body));
    }

    const target = new URL(route.base);
    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    for (const h of HOP_BY_HOP) delete headers[h];
    if (!headers['x-request-id']) {
      headers['x-request-id'] = (req as any).requestId ?? undefined;
    }
    if (body) {
      delete headers['content-length'];
      delete headers['transfer-encoding'];
      headers['content-length'] = String(body.length);
    }
    headers.host = target.host;
    headers['x-forwarded-for'] = (req.headers['x-forwarded-for'] as string) ?? req.socket.remoteAddress ?? '';

    const proxyReq = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: req.originalUrl,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.statusCode = proxyRes.statusCode ?? 502;
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (key.toLowerCase() === 'set-cookie') {
            res.setHeader('set-cookie', proxyRes.headers['set-cookie'] as string[]);
          } else if (value !== undefined) {
            res.setHeader(key, value);
          }
        }
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('error', (err) => {
      this.logger.error(`Proxy to ${route.base} failed: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ statusCode: 502, message: 'Service unavailable' });
      } else {
        res.destroy();
      }
    });

    if (body) {
      proxyReq.end(body);
    } else {
      req.pipe(proxyReq);
    }
  }
}