import { NotFoundException } from '@nestjs/common';
import { RadiusService } from './radius.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('RadiusService', () => {
  let service: RadiusService;
  const prisma = { subscriber: { findUnique: jest.fn() } };
  const db = { query: jest.fn(), execute: jest.fn() };
  const coa = { disconnectSession: jest.fn(), sendCoa: jest.fn() };
  const cache = { get: jest.fn(), set: jest.fn() };

  const subscriber = { pppoeUsername: 'ppp_user1' };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RADIUS_DEFAULT_PASSWORD = 'DevPass1!';
    service = new RadiusService(prisma as any, db as any, coa as any, cache as any);
    prisma.subscriber.findUnique.mockResolvedValue(subscriber);
    db.query.mockResolvedValue([]);
  });

  describe('activate', () => {
    it('creates the radcheck password row and returns the default password on first activation', async () => {
      const result = await service.activate('cust-1');
      expect(result).toMatchObject({ customerId: 'cust-1', username: 'ppp_user1', activated: true, defaultPassword: 'DevPass1!' });
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('SELECT id FROM radcheck'), expect.arrayContaining(['ppp_user1', 'Cleartext-Password']));
      expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO radcheck'), expect.arrayContaining(['ppp_user1', 'Cleartext-Password', ':=', 'DevPass1!']));
    });

    it('updates the password when the subscriber already had a row', async () => {
      db.query.mockResolvedValue([{ id: 7 }]);
      const result = await service.activate('cust-1');
      expect(result.defaultPassword).toBeUndefined();
      expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE radcheck'), expect.arrayContaining(['DevPass1!', 7]));
    });
  });

  describe('deactivate', () => {
    it('writes Auth-Type = Reject and disconnects the live session', async () => {
      const result = await service.deactivate('cust-1');
      expect(result).toMatchObject({ customerId: 'cust-1', username: 'ppp_user1', deactivated: true });
      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO radcheck"),
        expect.arrayContaining(['ppp_user1', 'Auth-Type', ':=', 'Reject']),
      );
      expect(coa.disconnectSession).toHaveBeenCalledWith('ppp_user1');
    });
  });

  describe('changePlan', () => {
    it('upserts the Mikrotik-Rate-Limit reply and sends a CoA', async () => {
      const result = await service.changePlan('cust-1', '8M/8M');
      expect(result).toMatchObject({ username: 'ppp_user1', rateLimit: '8M/8M' });
      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO radreply"),
        expect.arrayContaining(['ppp_user1', '8M/8M']),
      );
      expect(coa.sendCoa).toHaveBeenCalledWith('ppp_user1', { 'Mikrotik-Rate-Limit': '8M/8M' });
    });

    it('updates an existing Mikrotik-Rate-Limit reply', async () => {
      db.query.mockResolvedValue([{ id: 3 }]);
      await service.changePlan('cust-1', '4M/4M');
      expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE radreply'), expect.arrayContaining(['4M/4M', 3]));
    });
  });

  describe('getUsage', () => {
    it('aggregates radacct rows and caches the result for 30s', async () => {
      db.query.mockResolvedValue([
        { acctsessionid: 's1', acctuniqueid: 'u1', acctstarttime: new Date('2026-08-01T10:00:00Z'), acctstoptime: null, acctsessiontime: 300, acctinputoctets: 1000, acctoutputoctets: 2000, framedipaddress: '10.10.0.5' },
        { acctsessionid: 's2', acctuniqueid: 'u2', acctstarttime: new Date('2026-08-01T09:00:00Z'), acctstoptime: new Date('2026-08-01T09:30:00Z'), acctsessiontime: 1800, acctinputoctets: 500, acctoutputoctets: 700, framedipaddress: '10.10.0.5' },
      ]);
      cache.get.mockResolvedValue(null);

      const usage = await service.getUsage('cust-1');
      expect(usage?.online).toBe(true);
      expect(usage?.activeSession?.acctsessionid).toBe('s1');
      expect(usage?.totals).toEqual({ inputBytes: 1500, outputBytes: 2700, sessionSeconds: 2100, sessions: 2 });
      expect(cache.set).toHaveBeenCalledWith('radius:usage:cust-1', expect.anything(), 30);
    });

    it('serves the cached value without hitting the DB', async () => {
      const cached = { username: 'ppp_user1', online: true, activeSession: null, totals: { inputBytes: 1, outputBytes: 2, sessionSeconds: 3, sessions: 1 }, recent: [] };
      cache.get.mockResolvedValue(cached);
      const usage = await service.getUsage('cust-1');
      expect(usage).toEqual(cached);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  it('throws NotFoundException when the subscriber has no PPPoE username', async () => {
    cache.get.mockResolvedValue(null);
    prisma.subscriber.findUnique.mockResolvedValue({ pppoeUsername: null });
    await expect(service.activate('cust-1')).rejects.toThrow(NotFoundException);
    await expect(service.getUsage('cust-1')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for unknown subscribers', async () => {
    prisma.subscriber.findUnique.mockResolvedValue(null);
    await expect(service.deactivate('ghost')).rejects.toThrow(NotFoundException);
  });
});