import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { CacheService } from '@isp/cache';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RadiusDbService } from './radius-db.service';
import { CoaService } from './coa.service';
import { ProfilesService } from './profiles.service';

const CLEARTEXT = 'Cleartext-Password';
const AUTH_TYPE = 'Auth-Type';
const EXPIRATION = 'Expiration';
const USAGE_TTL = 30;

export interface RadiusUsage {
  username: string;
  online: boolean;
  activeSession: {
    acctsessionid: string;
    acctuniqueid: string;
    framedipaddress: string | null;
    acctstarttime: Date | null;
    acctsessiontime: number | null;
  } | null;
  totals: { inputBytes: number; outputBytes: number; sessionSeconds: number; sessions: number };
  recent: Array<{
    acctsessionid: string;
    acctstarttime: Date | null;
    acctstoptime: Date | null;
    acctsessiontime: number | null;
    acctinputoctets: number | null;
    acctoutputoctets: number | null;
    framedipaddress: string | null;
  }>;
}

interface AcctRow {
  acctsessionid: string;
  acctuniqueid: string;
  acctstarttime: Date | null;
  acctstoptime: Date | null;
  acctsessiontime: number | null;
  acctinputoctets: number | null;
  acctoutputoctets: number | null;
  framedipaddress: string | null;
}

@Injectable()
export class RadiusService {
  private readonly logger = new Logger(RadiusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly db: RadiusDbService,
    private readonly coa: CoaService,
    private readonly profiles: ProfilesService,
    @Inject('RADIUS_CACHE') private readonly cache: CacheService,
  ) {}

  private mask(secret: string | undefined, show = 4): string {
    if (!secret) return '(not set)';
    if (secret.length <= show) return '••••';
    return secret.slice(0, 1) + '••••' + secret.slice(-show);
  }

  async stats() {
    const count = async (sql: string, params: unknown[] = []): Promise<number> => {
      try {
        const rows = await this.db.query<Array<{ count: number | string }>>(sql, params);
        return Number(rows[0]?.count ?? 0);
      } catch {
        return -1;
      }
    };

    const [radcheck, withExpiry, activeSessions, acctTotal, groupTotal] = await Promise.all([
      count('SELECT COUNT(*) AS count FROM radcheck'),
      count("SELECT COUNT(*) AS count FROM radcheck WHERE attribute = 'Expiration'"),
      count('SELECT COUNT(*) AS count FROM radacct WHERE acctstoptime IS NULL'),
      count('SELECT COUNT(*) AS count FROM radacct'),
      count('SELECT COUNT(*) AS count FROM radusergroup'),
    ]);

    const dbOnline = radcheck >= 0;

    const [subscribers, cpes] = await Promise.all([
      this.prisma.subscriber.count({ where: { pppoeUsername: { not: null } } }).catch(() => -1),
      this.prisma.cpe.count({ where: { connectionType: 'STATIC_IP' } }).catch(() => -1),
    ]);

    return {
      dbOnline,
      radcheckUsers: radcheck,
      radcheckWithExpiry: withExpiry,
      activeSessions,
      acctRecords: acctTotal,
      radusergroup: groupTotal,
      subscribersWithUsername: subscribers,
      staticCpes: cpes,
      config: {
        sharedSecret: this.mask(process.env.RADIUS_SHARED_SECRET),
        defaultPassword: this.mask(process.env.RADIUS_DEFAULT_PASSWORD),
        dbHost: process.env.RADIUS_DB_HOST ?? 'localhost',
        dbPort: parseInt(process.env.RADIUS_DB_PORT ?? '3306', 10),
        dbUser: process.env.RADIUS_DB_USER ?? 'radius',
        dbName: process.env.RADIUS_DB_NAME ?? 'radius',
        coaEnabled: !!(process.env.RADIUS_COA_PORT || process.env.RADIUS_SHARED_SECRET),
      },
    };
  }

  private async requireUsername(customerId: string): Promise<string> {
    const subscriber = await this.prisma.subscriber.findUnique({
      where: { id: customerId },
      select: { pppoeUsername: true },
    });
    if (!subscriber || !subscriber.pppoeUsername) {
      throw new NotFoundException('Subscriber has no PPPoE username assigned');
    }
    return subscriber.pppoeUsername;
  }

  /**
   * radcheck has no unique key on (username, attribute) — do a proper
   * select-then-insert-or-update instead of ON DUPLICATE KEY.
   */
  private async upsertCheck(
    username: string,
    attribute: string,
    op: string,
    value: string,
  ): Promise<void> {
    const rows = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM radcheck WHERE username = ? AND attribute = ? LIMIT 1',
      [username, attribute],
    );
    if (rows.length > 0) {
      await this.db.execute('UPDATE radcheck SET op = ?, value = ? WHERE id = ?', [
        op,
        value,
        rows[0].id,
      ]);
    } else {
      await this.db.execute(
        'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)',
        [username, attribute, op, value],
      );
    }
  }

  async activate(customerId: string, opts?: { password?: string; expiresAt?: Date | string }): Promise<{
    customerId: string;
    username: string;
    activated: boolean;
    defaultPassword?: string;
    expiry?: string;
  }> {
    const username = await this.requireUsername(customerId);
    const password = opts?.password?.trim() || (process.env.RADIUS_DEFAULT_PASSWORD ?? 'ChangeMe1!');

    const existing = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM radcheck WHERE username = ? AND attribute = ? LIMIT 1',
      [username, CLEARTEXT],
    );
    const created = existing.length === 0;
    await this.upsertCheck(username, CLEARTEXT, ':=', password);
    await this.db.execute(
      'DELETE FROM radcheck WHERE username = ? AND attribute = ?',
      [username, AUTH_TYPE],
    );

    let expiry: string | undefined;
    await this.db.execute(
      'DELETE FROM radcheck WHERE username = ? AND attribute = ?',
      [username, EXPIRATION],
    );
    if (opts?.expiresAt) {
      const d = opts.expiresAt instanceof Date ? opts.expiresAt : new Date(opts.expiresAt);
      if (!isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, '0');
        expiry = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        await this.upsertCheck(username, EXPIRATION, ':=', expiry);
      }
    }

    this.logger.log(`Activated ${username} (customer ${customerId})${expiry ? ` · expires ${expiry}` : ''}`);
    return {
      customerId,
      username,
      activated: true,
      ...(expiry ? { expiry } : {}),
      ...(created ? { defaultPassword: password } : {}),
    };
  }

  async deactivate(customerId: string): Promise<{
    customerId: string;
    username: string;
    deactivated: boolean;
  }> {
    const username = await this.requireUsername(customerId);
    await this.upsertCheck(username, AUTH_TYPE, ':=', 'Reject');
    await this.coa.disconnectSession(username);

    this.logger.log(`Deactivated ${username} (customer ${customerId})`);
    return { customerId, username, deactivated: true };
  }

  async changePlan(
    customerId: string,
    rateLimit: string,
  ): Promise<{ customerId: string; username: string; rateLimit: string }> {
    const username = await this.requireUsername(customerId);
    const rows = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM radreply WHERE username = ? AND attribute = ? LIMIT 1',
      [username, 'Mikrotik-Rate-Limit'],
    );
    if (rows.length > 0) {
      await this.db.execute('UPDATE radreply SET value = ? WHERE id = ?', [rateLimit, rows[0].id]);
    } else {
      await this.db.execute(
        "INSERT INTO radreply (username, attribute, op, value) VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?)",
        [username, rateLimit],
      );
    }
    await this.coa.sendCoa(username, { 'Mikrotik-Rate-Limit': rateLimit });

    this.logger.log(`Plan rate-limit for ${username} set to ${rateLimit}`);
    return { customerId, username, rateLimit };
  }

  /**
   * Returns the RADIUS group profile currently assigned to a customer's
   * PPPoE username (radusergroup), if any, plus the per-subscriber static IP
   * state (Framed-IP-Address applied / unused).
   */
  async getProfile(customerId: string): Promise<{
    customerId: string;
    username: string;
    profile: string | null;
    rateLimit: string | null;
    staticIpMode: boolean;
    staticIpAddress: string | null;
    staticIpNetmask: string | null;
    framedIpAddress: string | null;
    framedIpNetmask: string | null;
    staticIpActive: boolean;
    staticIpUnused: boolean;
  }> {
    const username = await this.requireUsername(customerId);
    const [subscriber, groups, ipRows] = await Promise.all([
      this.prisma.subscriber.findUnique({
        where: { id: customerId },
        select: { staticIpAddress: true, staticIpNetmask: true },
      }),
      this.db.query<Array<{ groupname: string }>>(
        'SELECT groupname FROM radusergroup WHERE username = ? ORDER BY priority ASC LIMIT 1',
        [username],
      ),
      this.db.query<Array<{ attribute: string; value: string }>>(
        "SELECT attribute, value FROM radreply WHERE username = ? AND attribute IN ('Framed-IP-Address','Framed-IP-Netmask')",
        [username],
      ),
    ]);

    const profile = groups[0]?.groupname ?? null;
    const detail = profile ? await this.profiles.findOne(profile).catch(() => null) : null;
    const ipMap = new Map(ipRows.map((r) => [r.attribute, r.value]));
    const staticIpMode = detail?.staticIpMode ?? false;

    return {
      customerId,
      username,
      profile,
      rateLimit: detail?.rateLimit ?? null,
      staticIpMode,
      staticIpAddress: subscriber?.staticIpAddress ?? null,
      staticIpNetmask: subscriber?.staticIpNetmask ?? null,
      framedIpAddress: ipMap.get('Framed-IP-Address') ?? null,
      framedIpNetmask: ipMap.get('Framed-IP-Netmask') ?? null,
      staticIpActive: !!(staticIpMode && ipMap.get('Framed-IP-Address')),
      staticIpUnused: !!(subscriber?.staticIpAddress && !staticIpMode),
    };
  }

  /** Static IPs are for fiber clients on the local 192.x range. */
  private validateStaticIp(ip: string): string {
    const value = String(ip ?? '').trim();
    const parts = value.split('.');
    if (parts.length !== 4 || parts[0] !== '192') {
      throw new BadRequestException('Static IP must be in the 192.x.x.x range');
    }
    for (const part of parts) {
      const n = Number(part);
      if (!/^\d{1,3}$/.test(part) || n < 0 || n > 255) {
        throw new BadRequestException('Static IP is not a valid IPv4 address');
      }
    }
    return value;
  }

  private validateNetmask(mask: string): string {
    const value = String(mask ?? '').trim();
    const parts = value.split('.');
    if (parts.length !== 4) throw new BadRequestException('Netmask is not a valid IPv4 address');
    for (const part of parts) {
      const n = Number(part);
      if (!/^\d{1,3}$/.test(part) || n < 0 || n > 255) {
        throw new BadRequestException('Netmask is not a valid IPv4 address');
      }
    }
    return value;
  }

  private async upsertReply(username: string, attribute: string, value: string): Promise<void> {
    const rows = await this.db.query<Array<{ id: number }>>(
      'SELECT id FROM radreply WHERE username = ? AND attribute = ? LIMIT 1',
      [username, attribute],
    );
    if (rows.length > 0) {
      await this.db.execute('UPDATE radreply SET value = ? WHERE id = ?', [value, rows[0].id]);
    } else {
      await this.db.execute(
        "INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ':=', ?)",
        [username, attribute, value],
      );
    }
  }

  /**
   * Assigns (or clears) a RADIUS group profile for a customer's PPPoE
   * username. The group reply attributes take precedence over per-user
   * radreply rows, so the legacy per-user rate limit is removed on assignment.
   *
   * When the profile has `static_ip_mode`, a per-subscriber `Framed-IP-Address`
   * (192.x) is required and written to radreply; uniqueness is enforced both in
   * the database (Subscriber.staticIpAddress unique) and here with a clear error.
   */
  async assignProfile(
    customerId: string,
    opts: { profile: string | null; staticIpAddress?: string; staticIpNetmask?: string },
  ): Promise<Awaited<ReturnType<RadiusService['getProfile']>>> {
    const username = await this.requireUsername(customerId);
    const profile = opts.profile ? await this.profiles.findOne(opts.profile) : null;

    await this.db.execute('DELETE FROM radusergroup WHERE username = ?', [username]);
    if (opts.profile) {
      await this.db.execute(
        'INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)',
        [username, opts.profile],
      );
    }
    await this.db.execute(
      "DELETE FROM radreply WHERE username = ? AND attribute = 'Mikrotik-Rate-Limit'",
      [username],
    );

    if (profile?.staticIpMode) {
      if (!opts.staticIpAddress) {
        throw new BadRequestException('This profile requires a static IP address (192.x.x.x)');
      }
      const ip = this.validateStaticIp(opts.staticIpAddress);
      const netmask = opts.staticIpNetmask ? this.validateNetmask(opts.staticIpNetmask) : null;

      const clash = await this.prisma.subscriber.findFirst({
        where: { staticIpAddress: ip, id: { not: customerId }, deletedAt: null },
        select: { id: true, pppoeUsername: true },
      });
      if (clash) {
        throw new ConflictException(`Static IP ${ip} is already assigned to ${clash.pppoeUsername ?? 'another customer'}`);
      }
      const radiusClash = await this.db.query<Array<{ username: string }>>(
        "SELECT username FROM radreply WHERE attribute = 'Framed-IP-Address' AND value = ? AND username <> ? LIMIT 1",
        [ip, username],
      );
      if (radiusClash.length) {
        throw new ConflictException(`Static IP ${ip} is already applied to PPPoE user ${radiusClash[0].username}`);
      }

      try {
        await this.prisma.subscriber.update({
          where: { id: customerId },
          data: { staticIpAddress: ip, staticIpNetmask: netmask },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') throw new ConflictException(`Static IP ${ip} is already assigned to another customer`);
        throw e;
      }

      await this.upsertReply(username, 'Framed-IP-Address', ip);
      if (netmask) await this.upsertReply(username, 'Framed-IP-Netmask', netmask);
      else await this.db.execute("DELETE FROM radreply WHERE username = ? AND attribute = 'Framed-IP-Netmask'", [username]);
    } else {
      // Dynamic profile: stop applying the per-user static IP. The subscriber
      // record keeps the value so the UI can flag it as inactive/unused.
      await this.db.execute(
        "DELETE FROM radreply WHERE username = ? AND attribute IN ('Framed-IP-Address','Framed-IP-Netmask')",
        [username],
      );
    }

    if (profile?.rateLimit) {
      await this.coa.sendCoa(username, { 'Mikrotik-Rate-Limit': profile.rateLimit });
    }

    this.logger.log(`RADIUS profile for ${username} set to ${opts.profile ?? '(none)'}`);
    return this.getProfile(customerId);
  }

  async getUsage(customerId: string): Promise<RadiusUsage | null> {
    const cached = await this.cache.get<RadiusUsage | null>(
      `radius:usage:${customerId}`,
      (raw) => JSON.parse(raw),
    );
    if (cached) return cached;

    const username = await this.requireUsername(customerId);
    const rows = await this.db.query<AcctRow[]>(
      `SELECT acctsessionid, acctuniqueid, acctstarttime, acctstoptime,
              acctsessiontime, acctinputoctets, acctoutputoctets, framedipaddress
       FROM radacct
       WHERE username = ?
       ORDER BY acctstarttime DESC
       LIMIT 20`,
      [username],
    );

    const live = rows.filter((r) => r.acctstoptime === null);
    const usage: RadiusUsage = {
      username,
      online: live.length > 0,
      activeSession:
        live.length > 0
          ? {
              acctsessionid: live[0].acctsessionid,
              acctuniqueid: live[0].acctuniqueid,
              framedipaddress: live[0].framedipaddress,
              acctstarttime: live[0].acctstarttime,
              acctsessiontime: live[0].acctsessiontime,
            }
          : null,
      totals: rows.reduce(
        (acc, r) => ({
          inputBytes: acc.inputBytes + (Number(r.acctinputoctets) || 0),
          outputBytes: acc.outputBytes + (Number(r.acctoutputoctets) || 0),
          sessionSeconds: acc.sessionSeconds + (Number(r.acctsessiontime) || 0),
          sessions: acc.sessions + 1,
        }),
        { inputBytes: 0, outputBytes: 0, sessionSeconds: 0, sessions: 0 },
      ),
      recent: rows.map((r) => ({
        acctsessionid: r.acctsessionid,
        acctstarttime: r.acctstarttime,
        acctstoptime: r.acctstoptime,
        acctsessiontime: r.acctsessiontime,
        acctinputoctets: r.acctinputoctets,
        acctoutputoctets: r.acctoutputoctets,
        framedipaddress: r.framedipaddress,
      })),
    };

    await this.cache.set(`radius:usage:${customerId}`, usage, USAGE_TTL);
    return usage;
  }
}