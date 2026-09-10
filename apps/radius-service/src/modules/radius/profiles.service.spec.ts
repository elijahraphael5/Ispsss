import { ConflictException, BadRequestException } from '@nestjs/common';
import { ProfilesService } from './profiles.service';

describe('ProfilesService', () => {
  let service: ProfilesService;
  const db = { query: jest.fn(), execute: jest.fn() };

  let groupRows: Array<{ groupname: string; attribute: string; value: string }> = [];
  let userCounts: Record<string, number> = {};
  let meta: Record<string, boolean> = {};
  let joinAffected = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    groupRows = [];
    userCounts = {};
    meta = {};
    joinAffected = 0;
    service = new ProfilesService(db as any);

    db.execute.mockImplementation((sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO radgroupreply')) {
        groupRows.push({ groupname: params[0] as string, attribute: params[1] as string, value: params[2] as string });
      }
      if (sql.includes('INSERT INTO radius_profile_meta')) {
        meta[params[0] as string] = !!params[1];
      }
      if (sql.includes('DELETE FROM radgroupreply')) {
        groupRows = groupRows.filter((r) => r.groupname !== params[0]);
      }
      if (sql.includes('DELETE r FROM radreply')) {
        return Promise.resolve({ affectedRows: joinAffected });
      }
      return Promise.resolve({ affectedRows: 0 });
    });
    db.query.mockImplementation((sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM radgroupreply') && sql.includes('WHERE groupname = ?')) {
        return Promise.resolve(groupRows.filter((r) => r.groupname === params[0]));
      }
      if (sql.includes('FROM radgroupreply')) return Promise.resolve(groupRows);
      if (sql.includes('COUNT(*) AS count FROM radusergroup WHERE')) {
        return Promise.resolve([{ count: userCounts[params[0] as string] ?? 0 }]);
      }
      if (sql.includes('COUNT(*) AS count FROM radusergroup GROUP BY')) {
        return Promise.resolve(Object.entries(userCounts).map(([groupname, count]) => ({ groupname, count })));
      }
      if (sql.includes('FROM radius_profile_meta WHERE')) {
        const name = params[0] as string;
        return Promise.resolve(meta[name] === undefined ? [] : [{ static_ip_mode: meta[name] ? 1 : 0 }]);
      }
      if (sql.includes('FROM radius_profile_meta')) {
        return Promise.resolve(Object.entries(meta).map(([groupname, v]) => ({ groupname, static_ip_mode: v ? 1 : 0 })));
      }
      return Promise.resolve([]);
    });
  });

  it('lists profiles with attributes, static-ip mode and assigned user counts', async () => {
    groupRows = [
      { groupname: 'FIBER_STATIC', attribute: 'Mikrotik-Rate-Limit', value: '20M/20M' },
      { groupname: 'FIBER_STATIC', attribute: 'Session-Timeout', value: '3600' },
    ];
    userCounts = { FIBER_STATIC: 2 };
    meta = { FIBER_STATIC: true };

    const profiles = await service.list();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      name: 'FIBER_STATIC',
      rateLimit: '20M/20M',
      sessionTimeout: 3600,
      staticIpMode: true,
      users: 2,
    });
  });

  it('creates a profile, inserts reply attributes and stores static_ip_mode', async () => {
    const created = await service.create({ name: 'HOME_10M', rateLimit: '10M/10M', staticIpMode: true });
    // One insert per provided attribute.
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO radgroupreply'),
      ['HOME_10M', 'Mikrotik-Rate-Limit', '10M/10M'],
    );
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO radius_profile_meta'),
      ['HOME_10M', 1],
    );
    expect(created.name).toBe('HOME_10M');
    expect(created.staticIpMode).toBe(true);
  });

  it('rejects a profile with no attributes', async () => {
    await expect(service.create({ name: 'EMPTY' })).rejects.toThrow(BadRequestException);
  });

  it('rejects a duplicate profile name', async () => {
    groupRows = [{ groupname: 'HOME_10M', attribute: 'Mikrotik-Rate-Limit', value: '10M/10M' }];
    await expect(service.create({ name: 'HOME_10M', rateLimit: '10M/10M' })).rejects.toThrow(ConflictException);
  });

  it('toggling static → dynamic removes per-user Framed-IP rows and reports the count', async () => {
    groupRows = [{ groupname: 'FIBER_STATIC', attribute: 'Mikrotik-Rate-Limit', value: '20M/20M' }];
    meta = { FIBER_STATIC: true };
    userCounts = { FIBER_STATIC: 3 };
    joinAffected = 3;

    const result = await service.update('FIBER_STATIC', { staticIpMode: false });

    expect(result.removedStaticIps).toBe(3);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("r.attribute IN ('Framed-IP-Address', 'Framed-IP-Netmask')"),
      ['FIBER_STATIC'],
    );
    expect(meta.FIBER_STATIC).toBe(false);
  });

  it('refuses to delete a profile that still has users unless forced', async () => {
    groupRows = [{ groupname: 'HOME_10M', attribute: 'Mikrotik-Rate-Limit', value: '10M/10M' }];
    userCounts = { HOME_10M: 4 };

    await expect(service.remove('HOME_10M')).rejects.toThrow(ConflictException);

    const result = await service.remove('HOME_10M', true);
    expect(result).toEqual({ name: 'HOME_10M', deleted: true, usersUnassigned: 4 });
    expect(db.execute).toHaveBeenCalledWith('DELETE FROM radusergroup WHERE groupname = ?', ['HOME_10M']);
  });
});
