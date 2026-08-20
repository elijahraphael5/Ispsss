import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { CacheService } from '@isp/cache';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RadiusDbService } from './radius-db.service';
import { CoaService } from './coa.service';

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