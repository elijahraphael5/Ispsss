import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import type { Logger, LoggerOptions, DestinationStream } from 'pino';

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

const DEFAULT_REDACT = [
  'authorization',
  'password',
  'newPassword',
  'refreshToken',
  'req.headers.authorization',
  'req.body.password',
  '*.password',
];

export interface LoggerFactoryOptions {
  level?: string;
  stream?: DestinationStream;
  redact?: string[];
}

export function createLogger(opts: LoggerFactoryOptions = {}): Logger {
  const pinoOpts: LoggerOptions = {
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: opts.redact ?? DEFAULT_REDACT, censor: '[REDACTED]' },
  };
  if (opts.stream) return pino(pinoOpts, opts.stream);
  return pino(pinoOpts);
}

export function withRequestId<T>(requestId: string, fn: () => T): T {
  return requestContext.run({ requestId }, fn);
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

export function childWithContext(logger: Logger, extra?: Record<string, unknown>): Logger {
  const requestId = getRequestId();
  return logger.child({ ...(requestId ? { requestId } : {}), ...(extra ?? {}) });
}

export interface ProdEnvRule {
  name: string;
  /** Substring that marks the value as an unrotated dev default (e.g. 'change-me'). */
  forbidden?: string;
}

/**
 * Fails fast in production when required env vars are missing or still set to
 * known dev defaults. No-op outside NODE_ENV=production. Call after ConfigModule
 * has loaded the app's .env (i.e. inside bootstrap()).
 */
export function assertProdEnv(rules: ProdEnvRule[]): void {
  if (process.env.NODE_ENV !== 'production') return;
  const bad: string[] = [];
  for (const { name, forbidden } of rules) {
    const val = process.env[name];
    if (!val || (forbidden && val.includes(forbidden))) bad.push(name);
  }
  if (bad.length) {
    throw new Error(`Refusing to start in production — set real values for: ${bad.join(', ')}`);
  }
}