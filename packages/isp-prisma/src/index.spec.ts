import {
  SOFT_DELETE_MODELS,
  HISTORY_MODELS,
  filterDeletedAt,
  softDelete,
  softDeleteMany,
  restore,
  softDeleteQueryConfig,
  sanitizeForHistory,
  actionForData,
} from './index';

describe('filterDeletedAt', () => {
  it('injects deletedAt: null via AND to avoid OR bypass', () => {
    expect(filterDeletedAt({ where: { id: 'x' } })).toEqual({
      where: { AND: [{ deletedAt: null }, { id: 'x' }] },
    });
  });

  it('handles missing args and missing where', () => {
    expect(filterDeletedAt(undefined)).toEqual({ where: { deletedAt: null } });
    expect(filterDeletedAt({})).toEqual({ where: { deletedAt: null } });
  });

  it('preserves other args fields', () => {
    expect(filterDeletedAt({ where: { a: 1 }, select: { id: true }, take: 5 })).toEqual({
      where: { AND: [{ deletedAt: null }, { a: 1 }] },
      select: { id: true },
      take: 5,
    });
  });

  it('ANDs deletedAt over OR branches so soft-deleted rows cannot leak', () => {
    expect(filterDeletedAt({ where: { OR: [{ email: 'a@b.c' }, { phone: '123' }] } })).toEqual({
      where: { AND: [{ deletedAt: null }, { OR: [{ email: 'a@b.c' }, { phone: '123' }] }] },
    });
  });

  it('respects explicit deletedAt (restore/admin view)', () => {
    expect(filterDeletedAt({ where: { id: 'x', deletedAt: { not: null } } })).toEqual({
      where: { id: 'x', deletedAt: { not: null } },
    });
  });

  it('respects __includeDeleted escape hatch', () => {
    expect(filterDeletedAt({ where: { id: 'x', __includeDeleted: true } })).toEqual({
      where: { id: 'x' },
    });
  });
});

describe('model coverage', () => {
  it('registers soft-delete filtering for every model in the schema', () => {
    expect(SOFT_DELETE_MODELS).toHaveLength(42);
    for (const model of ['tenant', 'permission', 'chatMessage', 'refreshToken', 'pppoeSession', 'auditLog']) {
      expect(SOFT_DELETE_MODELS).toContain(model);
    }
    // The history store itself is append-only and never filtered.
    expect(SOFT_DELETE_MODELS).not.toContain('entityHistory');
  });

  it('keeps churn/telemetry tables out of edit history', () => {
    for (const model of [
      'routerMetric',
      'routerUsageDay',
      'pppoeSession',
      'routerSnapshot',
      'routerHealth',
      'paymentAttempt',
      'agentPresence',
      'refreshToken',
      'passwordResetToken',
      'actionQueue',
      'notification',
      'auditLog',
    ]) {
      expect(HISTORY_MODELS).not.toContain(model);
    }
    for (const model of ['user', 'subscriber', 'invoice', 'payment', 'chatMessage', 'ticket', 'networkDevice']) {
      expect(HISTORY_MODELS).toContain(model);
    }
  });
});

describe('softDelete / restore', () => {
  it('softDelete sets deletedAt to a Date', async () => {
    const update = jest.fn(async (a: any) => a);
    const delegate = { update };
    const before = Date.now();
    const res = await softDelete(delegate, { where: { id: 'x' }, select: { id: true } });
    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'x' });
    expect(arg.select).toEqual({ id: true });
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
    expect((arg.data.deletedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(res).toEqual(arg);
  });

  it('restore clears deletedAt', async () => {
    const update = jest.fn(async (a: any) => a);
    const delegate = { update };
    await restore(delegate, { where: { id: 'x' } });
    const arg = update.mock.calls[0][0];
    expect(arg.data.deletedAt).toBeNull();
  });

  it('softDeleteMany sets deletedAt via updateMany', async () => {
    const updateMany = jest.fn(async (a: any) => ({ count: a.where.id.in.length }));
    const delegate = { updateMany };
    await softDeleteMany(delegate, { where: { id: { in: ['a', 'b'] } } });
    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: { in: ['a', 'b'] } });
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
  });
});

describe('softDeleteQueryConfig', () => {
  it('registers read filtering for every soft-deletable model', () => {
    const query = softDeleteQueryConfig as any;
    for (const model of SOFT_DELETE_MODELS) {
      expect(query[model]).toBeDefined();
      expect(query[model].findMany).toBeDefined();
      expect(query[model].findUnique).toBeDefined();
      expect(query[model].count).toBeDefined();
    }
  });

  it('filters deletedAt on findMany through the query config', async () => {
    const query = softDeleteQueryConfig as any;
    const upstream = jest.fn(async (a: any) => a);
    await query.invoice.findMany({ args: { where: { subscriberId: 's1' } }, query: upstream });
    expect(upstream).toHaveBeenCalledWith({
      where: { AND: [{ deletedAt: null }, { subscriberId: 's1' }] },
    });
  });
});

describe('sanitizeForHistory', () => {
  it('redacts sensitive fields recursively', () => {
    const snapshot = {
      id: 'u1',
      email: 'a@b.c',
      passwordHash: 'secret-hash',
      twoFaSecret: 'otpauth://...',
      nested: { passwordHash: 'nested-hash', ok: true },
      list: [{ tokenHash: 'x' }, { ok: 1 }],
    };
    expect(sanitizeForHistory(snapshot)).toEqual({
      id: 'u1',
      email: 'a@b.c',
      passwordHash: '[REDACTED]',
      twoFaSecret: '[REDACTED]',
      nested: { passwordHash: '[REDACTED]', ok: true },
      list: [{ tokenHash: '[REDACTED]' }, { ok: 1 }],
    });
  });

  it('serializes dates and bigints', () => {
    const d = new Date('2026-01-02T03:04:05.000Z');
    expect(sanitizeForHistory({ d, b: BigInt(12345) })).toEqual({
      d: '2026-01-02T03:04:05.000Z',
      b: '12345',
    });
  });

  it('passes primitives through', () => {
    expect(sanitizeForHistory(undefined)).toBeUndefined();
    expect(sanitizeForHistory(null)).toBeNull();
    expect(sanitizeForHistory('x')).toBe('x');
    expect(sanitizeForHistory(7)).toBe(7);
  });
});

describe('actionForData', () => {
  it('classifies the soft-delete lifecycle', () => {
    expect(actionForData({ deletedAt: new Date() })).toBe('SOFT_DELETED');
    expect(actionForData({ deletedAt: null })).toBe('RESTORED');
    expect(actionForData({ name: 'x' })).toBe('UPDATED');
    expect(actionForData(undefined)).toBe('UPDATED');
  });
});
