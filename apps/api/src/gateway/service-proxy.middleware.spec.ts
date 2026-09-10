import { ServiceProxyMiddleware } from './service-proxy.middleware';
import * as http from 'http';

jest.mock('http', () => ({
  request: jest.fn(),
}));

describe('ServiceProxyMiddleware', () => {
  let middleware: ServiceProxyMiddleware;
  let next: jest.Mock;

  const makeRes = () => ({
    statusCode: 200,
    headersSent: false,
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    pipe: jest.fn(),
    destroy: jest.fn(),
  });

  const makeReq = (overrides: Record<string, unknown> = {}) => ({
    path: '/api/v1/auth/login',
    originalUrl: '/api/v1/auth/login',
    method: 'GET',
    headers: {},
    body: undefined,
    socket: { remoteAddress: '127.0.0.1' },
    pipe: jest.fn(),
    ...overrides,
  });

  const makeProxyReq = () => {
    const listeners: Record<string, (...args: any[]) => void> = {};
    const proxyReq: any = {
      setTimeout: jest.fn((_ms: number, cb: () => void) => {
        listeners.timeout = cb;
      }),
      on: jest.fn((evt: string, cb: (...args: any[]) => void) => {
        listeners[evt] = cb;
      }),
      end: jest.fn(),
      pipe: jest.fn(),
      destroy: jest.fn((err?: Error) => {
        if (err && listeners.error) listeners.error(err);
      }),
    };
    return { proxyReq, listeners };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = new ServiceProxyMiddleware();
    next = jest.fn();
  });

  it('passes non-proxied paths through to next()', () => {
    const req = makeReq({ path: '/api/v1/users', originalUrl: '/api/v1/users' });
    const res = makeRes();
    middleware.use(req as any, res as any, next);
    expect(next).toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
  });

  it('proxies /api/v1/auth to the auth service', () => {
    const { proxyReq } = makeProxyReq();
    (http.request as jest.Mock).mockReturnValue(proxyReq);
    const req = makeReq();
    const res = makeRes();
    middleware.use(req as any, res as any, next);
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'localhost', port: '4101' }),
      expect.any(Function),
    );
    expect(proxyReq.setTimeout).toHaveBeenCalled();
  });

  it('responds 504 when the upstream times out', () => {
    const { proxyReq, listeners } = makeProxyReq();
    (http.request as jest.Mock).mockReturnValue(proxyReq);
    const req = makeReq();
    const res = makeRes();
    middleware.use(req as any, res as any, next);
    listeners.timeout();
    expect(res.status).toHaveBeenCalledWith(504);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 504, message: 'Gateway timeout' });
  });

  it('responds 502 on a connection error', () => {
    const { proxyReq, listeners } = makeProxyReq();
    (http.request as jest.Mock).mockReturnValue(proxyReq);
    const req = makeReq();
    const res = makeRes();
    middleware.use(req as any, res as any, next);
    listeners.error(new Error('connect ECONNREFUSED'));
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 502, message: 'Service unavailable' });
  });
});
