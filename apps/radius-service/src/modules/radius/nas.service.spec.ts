import { NotFoundException } from '@nestjs/common';
import { NasService } from './nas.service';

describe('NasService', () => {
  let service: NasService;
  const db = { query: jest.fn(), execute: jest.fn() };
  const connectivity = { udpProbe: jest.fn(), authProbe: jest.fn() };

  const row = {
    id: 1,
    nasname: '203.0.113.10',
    shortname: 'mtk-main',
    type: 'mikrotik',
    ports: 1812,
    secret: 'supersecret',
    server: null,
    community: null,
    description: 'Main NAS',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NasService(db as any, connectivity as any);
    db.execute.mockResolvedValue({ insertId: 1, affectedRows: 1 });
  });

  it('lists NAS entries without ever returning the plaintext secret', async () => {
    db.query.mockResolvedValue([row]);
    const result = await service.list();
    expect(result).toHaveLength(1);
    expect(result[0].secretMasked).toBe('s••••cret');
    expect(result[0].hasSecret).toBe(true);
    expect((result[0] as any).secret).toBeUndefined();
  });

  it('creates a NAS row and returns the masked view', async () => {
    db.query.mockResolvedValue([row]);
    const created = await service.create({
      nasname: '203.0.113.10',
      shortname: 'mtk-main',
      type: 'mikrotik',
      ports: 1812,
      secret: 'supersecret',
    });
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO nas'),
      expect.arrayContaining(['203.0.113.10', 'mtk-main', 'mikrotik', 1812, 'supersecret']),
    );
    expect(created.secretMasked).toBe('s••••cret');
  });

  it('throws NotFound for a missing NAS', async () => {
    db.query.mockResolvedValue([]);
    await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
  });

  it('update without a secret keeps the stored one', async () => {
    db.query.mockResolvedValue([row]);
    await service.update(1, { shortname: 'renamed' });
    const sql = db.execute.mock.calls[0][0] as string;
    expect(sql).toContain('shortname = ?');
    expect(sql).not.toContain('secret = ?');
  });

  it('update with a secret writes the new value', async () => {
    db.query.mockResolvedValue([row]);
    await service.update(1, { secret: 'brandnewsecret' });
    const sql = db.execute.mock.calls[0][0] as string;
    const params = db.execute.mock.calls[0][1] as unknown[];
    expect(sql).toContain('secret = ?');
    expect(params).toContain('brandnewsecret');
  });

  it('deletes a NAS row', async () => {
    db.query.mockResolvedValue([row]);
    const result = await service.remove(1);
    expect(result).toEqual({ id: 1, deleted: true });
    expect(db.execute).toHaveBeenCalledWith('DELETE FROM nas WHERE id = ?', [1]);
  });

  it('test combines the NAS UDP probes and the RADIUS auth probe', async () => {
    db.query.mockResolvedValue([row]);
    connectivity.udpProbe
      .mockResolvedValueOnce({ status: 'reachable', latencyMs: 12, detail: 'udp' })
      .mockResolvedValueOnce({ status: 'no-response', latencyMs: null, detail: 'timeout' });
    connectivity.authProbe.mockResolvedValue({ status: 'reject', latencyMs: 30, detail: 'Access-Reject' });

    const result = await service.test(1);

    expect(result.reachable).toBe(true);
    expect(result.networkStatus).toBe('reachable');
    expect(result.accountingReachable).toBe(false);
    expect(result.authStatus).toBe('reject');
    expect(result.latencyMs).toBe(12);
    // No secret material leaks into the result.
    expect(JSON.stringify(result)).not.toContain('supersecret');
  });

  it('test reports unreachable when both NAS probes fail', async () => {
    db.query.mockResolvedValue([row]);
    connectivity.udpProbe.mockResolvedValue({ status: 'unreachable', latencyMs: null, detail: 'EHOSTUNREACH' });
    connectivity.authProbe.mockResolvedValue({ status: 'no-response', latencyMs: null, detail: 'timeout' });

    const result = await service.test(1);
    expect(result.reachable).toBe(false);
    expect(result.networkStatus).toBe('unreachable');
  });
});
