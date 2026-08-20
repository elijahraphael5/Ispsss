import { RadiusDbService } from './radius-db.service';

jest.mock('mysql2/promise', () => ({
  __esModule: true,
  default: {
    createPool: jest.fn(() => ({
      query: jest.fn(async () => [[{ a: 1 }], []]),
      execute: jest.fn(async () => [{ affectedRows: 1, insertId: 0 }, []]),
      end: jest.fn(async () => undefined),
    })),
  },
  createPool: jest.fn(() => ({
    query: jest.fn(async () => [[{ a: 1 }], []]),
    execute: jest.fn(async () => [{ affectedRows: 1, insertId: 0 }, []]),
    end: jest.fn(async () => undefined),
  })),
}));

describe('RadiusDbService', () => {
  it('queries with params and returns rows', async () => {
    const svc = new RadiusDbService();
    const rows = await svc.query('SELECT value FROM radcheck WHERE username = ?', ['ppp_user']);
    expect(rows).toEqual([{ a: 1 }]);
  });

  it('executes writes and returns the ResultSetHeader', async () => {
    const svc = new RadiusDbService();
    const result = await svc.execute('INSERT INTO radcheck (username) VALUES (?)', ['ppp_user']);
    expect(result.affectedRows).toBe(1);
  });

  it('closes the pool on module destroy', async () => {
    const svc = new RadiusDbService();
    await svc.onModuleDestroy();
  });
});