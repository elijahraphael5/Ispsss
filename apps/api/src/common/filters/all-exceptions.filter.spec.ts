import { HttpException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import * as Sentry from '@sentry/node';

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  withScope: jest.fn((cb: (scope: any) => void) =>
    cb({ setTag: jest.fn(), setExtra: jest.fn() }),
  ),
}));

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  const makeHost = (req: any, res: any) =>
    ({
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    }) as any;

  const makeRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new AllExceptionsFilter();
  });

  afterEach(() => {
    delete process.env.SENTRY_DSN;
  });

  it('maps a generic error to 500 without reporting when SENTRY_DSN is unset', () => {
    delete process.env.SENTRY_DSN;
    const res = makeRes();
    filter.catch(new Error('boom'), makeHost({ method: 'GET', url: '/x' }, res));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, path: '/x' }),
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('preserves HttpException status codes', () => {
    const res = makeRes();
    filter.catch(new HttpException('nope', 400), makeHost({ method: 'POST', url: '/y' }, res));
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('reports to Sentry only when SENTRY_DSN is set', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.invalid/1';
    const res = makeRes();
    const err = new Error('boom');
    filter.catch(err, makeHost({ method: 'GET', url: '/z' }, res));
    expect(Sentry.withScope).toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });
});
