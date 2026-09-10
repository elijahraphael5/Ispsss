import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { RadiusDbService } from './radius-db.service';
import { CreateProfileDto, UpdateProfileDto } from './dto/nas.dto';

/** Profile field → RADIUS reply attribute (radgroupreply). */
const ATTRIBUTE_MAP = {
  rateLimit: 'Mikrotik-Rate-Limit',
  sessionTimeout: 'Session-Timeout',
  idleTimeout: 'Idle-Timeout',
  framedPool: 'Framed-Pool',
} as const;

type ProfileField = keyof typeof ATTRIBUTE_MAP;

interface GroupRow {
  groupname: string;
  attribute: string;
  value: string;
}

export interface ProfileView {
  name: string;
  rateLimit: string | null;
  sessionTimeout: number | null;
  idleTimeout: number | null;
  framedPool: string | null;
  staticIpMode: boolean;
  users: number;
  attributes: Record<string, string>;
}

/**
 * PPPoE profiles backed by RADIUS groups (radgroupreply). Assigning a profile
 * to a customer writes radusergroup for the subscriber's PPPoE username; the
 * group's reply attributes then apply on the next auth (and via CoA).
 *
 * `static_ip_mode` is app metadata (not a RADIUS attribute) kept in the small
 * `radius_profile_meta` table in the same MariaDB database.
 */
@Injectable()
export class ProfilesService implements OnModuleInit {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(private readonly db: RadiusDbService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.db.execute(
        `CREATE TABLE IF NOT EXISTS radius_profile_meta (
           groupname varchar(64) NOT NULL,
           static_ip_mode tinyint(1) NOT NULL DEFAULT 0,
           updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           PRIMARY KEY (groupname)
         ) ENGINE=InnoDB`,
      );
    } catch (err: any) {
      this.logger.warn(`Could not ensure radius_profile_meta table: ${err?.message ?? err}`);
    }
  }

  private async metaMap(): Promise<Map<string, boolean>> {
    try {
      const rows = await this.db.query<Array<{ groupname: string; static_ip_mode: number | string | boolean }>>(
        'SELECT groupname, static_ip_mode FROM radius_profile_meta',
      );
      return new Map(rows.map((r) => [r.groupname, !!Number(r.static_ip_mode)]));
    } catch {
      return new Map();
    }
  }

  private async getStaticIpMode(name: string): Promise<boolean> {
    try {
      const rows = await this.db.query<Array<{ static_ip_mode: number | string | boolean }>>(
        'SELECT static_ip_mode FROM radius_profile_meta WHERE groupname = ? LIMIT 1',
        [name],
      );
      return rows.length ? !!Number(rows[0].static_ip_mode) : false;
    } catch {
      return false;
    }
  }

  private async setStaticIpMode(name: string, mode: boolean): Promise<void> {
    await this.db.execute(
      `INSERT INTO radius_profile_meta (groupname, static_ip_mode) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE static_ip_mode = VALUES(static_ip_mode)`,
      [name, mode ? 1 : 0],
    );
  }

  private toView(name: string, rows: GroupRow[], users: number, staticIpMode: boolean): ProfileView {
    const attributes: Record<string, string> = {};
    for (const row of rows) attributes[row.attribute] = row.value;
    const num = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));

    return {
      name,
      rateLimit: attributes[ATTRIBUTE_MAP.rateLimit] ?? null,
      sessionTimeout: num(attributes[ATTRIBUTE_MAP.sessionTimeout]),
      idleTimeout: num(attributes[ATTRIBUTE_MAP.idleTimeout]),
      framedPool: attributes[ATTRIBUTE_MAP.framedPool] ?? null,
      staticIpMode,
      users,
      attributes,
    };
  }

  async list(): Promise<ProfileView[]> {
    let rows: GroupRow[];
    let counts: Array<{ groupname: string; count: number | string }>;
    let meta: Map<string, boolean>;
    try {
      [rows, counts, meta] = await Promise.all([
        this.db.query<GroupRow[]>(
          'SELECT groupname, attribute, value FROM radgroupreply ORDER BY groupname ASC, attribute ASC',
        ),
        this.db.query<Array<{ groupname: string; count: number | string }>>(
          'SELECT groupname, COUNT(*) AS count FROM radusergroup GROUP BY groupname',
        ),
        this.metaMap(),
      ]);
    } catch (e: any) {
      if (e?.fatal || ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(e?.code)) {
        throw new ServiceUnavailableException('RADIUS database unreachable — is MariaDB running?');
      }
      throw e;
    }

    const countMap = new Map(counts.map((c) => [c.groupname, Number(c.count)]));
    const grouped = new Map<string, GroupRow[]>();
    for (const row of rows) {
      const list = grouped.get(row.groupname) ?? [];
      list.push(row);
      grouped.set(row.groupname, list);
    }

    return [...grouped.entries()]
      .map(([name, groupRows]) => this.toView(name, groupRows, countMap.get(name) ?? 0, meta.get(name) ?? false))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async findOne(name: string): Promise<ProfileView> {
    const rows = await this.db.query<GroupRow[]>(
      'SELECT groupname, attribute, value FROM radgroupreply WHERE groupname = ? ORDER BY attribute ASC',
      [name],
    );
    if (!rows.length) throw new NotFoundException(`Profile "${name}" not found`);
    const [users, staticIpMode] = await Promise.all([
      this.db.query<Array<{ count: number | string }>>(
        'SELECT COUNT(*) AS count FROM radusergroup WHERE groupname = ?',
        [name],
      ),
      this.getStaticIpMode(name),
    ]);
    return this.toView(name, rows, Number(users[0]?.count ?? 0), staticIpMode);
  }

  private attributeRows(dto: CreateProfileDto | UpdateProfileDto): Array<{ attribute: string; value: string }> {
    const rows: Array<{ attribute: string; value: string }> = [];
    if (dto.rateLimit !== undefined && dto.rateLimit !== '') {
      rows.push({ attribute: ATTRIBUTE_MAP.rateLimit, value: dto.rateLimit });
    }
    if (dto.sessionTimeout !== undefined) {
      rows.push({ attribute: ATTRIBUTE_MAP.sessionTimeout, value: String(dto.sessionTimeout) });
    }
    if (dto.idleTimeout !== undefined) {
      rows.push({ attribute: ATTRIBUTE_MAP.idleTimeout, value: String(dto.idleTimeout) });
    }
    if (dto.framedPool !== undefined && dto.framedPool !== '') {
      rows.push({ attribute: ATTRIBUTE_MAP.framedPool, value: dto.framedPool });
    }
    return rows;
  }

  async create(dto: CreateProfileDto): Promise<ProfileView> {
    const existing = await this.db.query<Array<{ groupname: string }>>(
      'SELECT groupname FROM radgroupreply WHERE groupname = ? LIMIT 1',
      [dto.name],
    );
    if (existing.length) throw new ConflictException(`A profile named "${dto.name}" already exists`);

    const rows = this.attributeRows(dto);
    if (!rows.length) throw new BadRequestException('At least one profile attribute (rate limit, timeouts or IP pool) is required');
    for (const row of rows) {
      await this.db.execute(
        "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ':=', ?)",
        [dto.name, row.attribute, row.value],
      );
    }
    if (dto.staticIpMode !== undefined) await this.setStaticIpMode(dto.name, dto.staticIpMode);
    this.logger.log(`Profile created: ${dto.name}`);
    return this.findOne(dto.name);
  }

  async update(name: string, dto: UpdateProfileDto): Promise<ProfileView & { removedStaticIps: number }> {
    const before = await this.findOne(name);
    const rows = this.attributeRows(dto);

    // Only touch reply attributes when the request actually changes them —
    // toggling static_ip_mode alone must not wipe the rate limit/timeouts.
    const hasAttributeChanges = dto.rateLimit !== undefined || dto.sessionTimeout !== undefined
      || dto.idleTimeout !== undefined || dto.framedPool !== undefined;

    if (hasAttributeChanges) {
      await this.db.execute('DELETE FROM radgroupreply WHERE groupname = ?', [name]);
      for (const row of rows) {
        await this.db.execute(
          "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ':=', ?)",
          [name, row.attribute, row.value],
        );
      }
    }
    if (dto.staticIpMode !== undefined) await this.setStaticIpMode(name, dto.staticIpMode);

    // Toggling static → dynamic: stop applying per-user Framed-IP-Address rows
    // for this group's users (the subscriber records keep the IP, flagged
    // unused in the UI) so a stale static IP isn't silently applied.
    let removedStaticIps = 0;
    if (before.staticIpMode && dto.staticIpMode === false) {
      const result = await this.db.execute(
        `DELETE r FROM radreply r
         JOIN radusergroup ug ON ug.username = r.username
         WHERE ug.groupname = ? AND r.attribute IN ('Framed-IP-Address', 'Framed-IP-Netmask')`,
        [name],
      );
      removedStaticIps = result.affectedRows ?? 0;
    }

    this.logger.log(`Profile updated: ${name}`);
    return { ...(await this.findOne(name)), removedStaticIps };
  }

  async remove(name: string, force = false): Promise<{ name: string; deleted: boolean; usersUnassigned: number }> {
    await this.findOne(name);
    const counts = await this.db.query<Array<{ count: number | string }>>(
      'SELECT COUNT(*) AS count FROM radusergroup WHERE groupname = ?',
      [name],
    );
    const users = Number(counts[0]?.count ?? 0);
    if (users > 0 && !force) {
      throw new ConflictException(
        `This profile is assigned to ${users} customer(s). Reassign them or retry with force=true to unassign and delete.`,
      );
    }

    await this.db.execute('DELETE FROM radgroupreply WHERE groupname = ?', [name]);
    await this.db.execute('DELETE FROM radgroupcheck WHERE groupname = ?', [name]);
    await this.db.execute('DELETE FROM radusergroup WHERE groupname = ?', [name]);
    this.logger.log(`Profile deleted: ${name} (${users} users unassigned)`);
    return { name, deleted: true, usersUnassigned: users };
  }
}
