import { Writable } from 'node:stream';
import { createLogger, getRequestId, withRequestId, childWithContext, assertProdEnv } from './index';

function collectStream(): { stream: Writable; lines: () => Array<Record<string, any>> } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return {
    stream,
    lines: () => chunks.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>),
  };
}

describe('@isp/logger', () => {
  it('emits JSON lines with iso timestamp', () => {
    const { stream, lines } = collectStream();
    const logger = createLogger({ stream });
    logger.info({ hello: 'world' }, 'msg');
    const [line] = lines();
    expect(line).toBeDefined();
    expect(typeof line['time']).toBe('string');
    expect(new Date(line['time']).getTime()).not.toBeNaN();
    expect(line['hello']).toBe('world');
    expect(line['msg']).toBe('msg');
  });

  it('redacts secrets by default', () => {
    const { stream, lines } = collectStream();
    const logger = createLogger({ stream });
    logger.info({ password: 'hunter2', authorization: 'Bearer sekrit', ok: 1 });
    const [line] = lines();
    expect(line['password']).toBe('[REDACTED]');
    expect(line['authorization']).toBe('[REDACTED]');
    expect(line['ok']).toBe(1);
  });

  it('redacts nested sensitive fields', () => {
    const { stream, lines } = collectStream();
    const logger = createLogger({ stream });
    logger.info({ req: { headers: { authorization: 'Bearer x' } }, body: { password: 'pw' } });
    const [line] = lines();
    expect(line['req']['headers']['authorization']).toBe('[REDACTED]');
    expect(line['body']['password']).toBe('[REDACTED]');
  });

  it('respects custom redact paths', () => {
    const { stream, lines } = collectStream();
    const logger = createLogger({ stream, redact: ['apiKey'] });
    logger.info({ apiKey: 'abc', password: 'visible-here' });
    const [line] = lines();
    expect(line['apiKey']).toBe('[REDACTED]');
    expect(line['password']).toBe('visible-here');
  });

  it('respects log level and omits below it', () => {
    const { stream, lines } = collectStream();
    const logger = createLogger({ stream, level: 'warn' });
    logger.info('not emitted');
    logger.warn('emitted');
    expect(lines().length).toBe(1);
    expect(lines()[0]['msg']).toBe('emitted');
  });

  it('injects requestId into child logs within an ALS context', () => {
    const { stream, lines } = collectStream();
    const logger = createLogger({ stream });
    withRequestId('req-42', () => {
      childWithContext(logger).info('inside');
    });
    expect(lines()[0]['requestId']).toBe('req-42');
  });

  it('omits requestId outside a context and supports extra fields', () => {
    const { stream, lines } = collectStream();
    const logger = createLogger({ stream });
    childWithContext(logger, { tenant: 't1' }).info('outside');
    const [line] = lines();
    expect(line['requestId']).toBeUndefined();
    expect(line['tenant']).toBe('t1');
  });

  it('getRequestId returns undefined when no context', () => {
    expect(getRequestId()).toBeUndefined();
    withRequestId('abc', () => {
      expect(getRequestId()).toBe('abc');
    });
    expect(getRequestId()).toBeUndefined();
  });
});
describe('assertProdEnv', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = prevNodeEnv;
    delete process.env.TEST_REQUIRED_VAR;
    delete process.env.TEST_DEFAULT_VAR;
  });

  it('is a no-op outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.TEST_REQUIRED_VAR;
    expect(() => assertProdEnv([{ name: 'TEST_REQUIRED_VAR' }])).not.toThrow();
  });

  it('throws when a required var is missing in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.TEST_REQUIRED_VAR;
    expect(() => assertProdEnv([{ name: 'TEST_REQUIRED_VAR' }])).toThrow(/TEST_REQUIRED_VAR/);
  });

  it('throws when a var still holds a dev default in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.TEST_DEFAULT_VAR = 'change-me';
    expect(() => assertProdEnv([{ name: 'TEST_DEFAULT_VAR', forbidden: 'change-me' }])).toThrow(/TEST_DEFAULT_VAR/);
  });

  it('passes when all vars are set to real values', () => {
    process.env.NODE_ENV = 'production';
    process.env.TEST_REQUIRED_VAR = 'real-secret';
    expect(() => assertProdEnv([{ name: 'TEST_REQUIRED_VAR' }])).not.toThrow();
  });
});
