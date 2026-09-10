import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { RadiusDbService } from './radius-db.service';
import { RadiusConnectivityService, NetworkStatus, AuthStatus } from './radius-connectivity.service';
import { CreateNasDto, UpdateNasDto } from './dto/nas.dto';

interface NasRow {
  id: number;
  nasname: string;
  shortname: string | null;
  type: string | null;
  ports: number | null;
  secret: string;
  server: string | null;
  community: string | null;
  description: string | null;
}

export interface NasView {
  id: number;
  nasname: string;
  shortname: string | null;
  type: string | null;
  ports: number | null;
  description: string | null;
  hasSecret: boolean;
  secretMasked: string;
}

export interface NasTestResult {
  nasId: number;
  nasname: string;
  reachable: boolean;
  networkStatus: NetworkStatus;
  latencyMs: number | null;
  accountingReachable: boolean;
  authStatus: AuthStatus;
  authLatencyMs: number | null;
  radiusServer: string;
  checkedAt: string;
  message: string;
}

/**
 * CRUD for the MariaDB `nas` table that FreeRADIUS reads when
 * `read_clients = yes`. Secrets are write-only: responses only ever contain a
 * masked preview, never the stored value.
 */
@Injectable()
export class NasService {
  private readonly logger = new Logger(NasService.name);

  constructor(
    private readonly db: RadiusDbService,
    private readonly connectivity: RadiusConnectivityService,
  ) {}

  private mask(secret: string | null | undefined): string {
    if (!secret) return '(not set)';
    if (secret.length <= 4) return '••••';
    return secret.slice(0, 1) + '••••' + secret.slice(-4);
  }

  private toView(row: NasRow): NasView {
    return {
      id: row.id,
      nasname: row.nasname,
      shortname: row.shortname,
      type: row.type,
      ports: row.ports,
      description: row.description,
      hasSecret: !!row.secret,
      secretMasked: this.mask(row.secret),
    };
  }

  async list(): Promise<NasView[]> {
    let rows: NasRow[];
    try {
      rows = await this.db.query<NasRow[]>(
        'SELECT id, nasname, shortname, type, ports, secret, server, community, description FROM nas ORDER BY id ASC',
      );
    } catch (e: any) {
      if (e?.fatal || ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(e?.code)) {
        throw new ServiceUnavailableException('RADIUS database unreachable — is MariaDB running?');
      }
      throw e;
    }
    return rows.map((r) => this.toView(r));
  }

  private async getRow(id: number): Promise<NasRow> {
    const rows = await this.db.query<NasRow[]>(
      'SELECT id, nasname, shortname, type, ports, secret, server, community, description FROM nas WHERE id = ? LIMIT 1',
      [id],
    );
    if (!rows.length) throw new NotFoundException(`NAS ${id} not found`);
    return rows[0];
  }

  async findOne(id: number): Promise<NasView> {
    return this.toView(await this.getRow(id));
  }

  async create(dto: CreateNasDto): Promise<NasView> {
    const result = await this.db.execute(
      'INSERT INTO nas (nasname, shortname, type, ports, secret, description) VALUES (?, ?, ?, ?, ?, ?)',
      [
        dto.nasname.trim(),
        dto.shortname?.trim() || null,
        dto.type?.trim() || 'other',
        dto.ports ?? 1812,
        dto.secret,
        dto.description?.trim() || 'RADIUS Client',
      ],
    );
    this.logger.log(`NAS created: ${dto.nasname} (id ${result.insertId})`);
    return this.findOne(Number(result.insertId));
  }

  async update(id: number, dto: UpdateNasDto): Promise<NasView> {
    await this.getRow(id);
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown) => {
      sets.push(`${column} = ?`);
      params.push(value);
    };

    if (dto.nasname !== undefined) set('nasname', dto.nasname.trim());
    if (dto.shortname !== undefined) set('shortname', dto.shortname.trim() || null);
    if (dto.type !== undefined) set('type', dto.type.trim() || 'other');
    if (dto.ports !== undefined) set('ports', dto.ports);
    if (dto.description !== undefined) set('description', dto.description.trim() || null);
    // Secret is only touched when a new value is supplied (blank = keep current).
    if (dto.secret) set('secret', dto.secret);

    if (sets.length) {
      params.push(id);
      await this.db.execute(`UPDATE nas SET ${sets.join(', ')} WHERE id = ?`, params);
      this.logger.log(`NAS updated: id ${id}`);
    }
    return this.findOne(id);
  }

  async remove(id: number): Promise<{ id: number; deleted: boolean }> {
    await this.getRow(id);
    await this.db.execute('DELETE FROM nas WHERE id = ?', [id]);
    this.logger.log(`NAS deleted: id ${id}`);
    return { id, deleted: true };
  }

  /**
   * Connectivity test: UDP probes to the NAS on 1812/1813 (network) plus a
   * RADIUS Access-Request against the FreeRADIUS server (auth path). Never
   * sends live customer credentials and never logs secrets.
   */
  async test(id: number): Promise<NasTestResult> {
    const nas = await this.getRow(id);
    const radiusHost = process.env.RADIUS_SERVER_HOST ?? '127.0.0.1';
    const radiusPort = parseInt(process.env.RADIUS_SERVER_PORT ?? '1812', 10);

    const [authPort, acctPort] = await Promise.all([
      this.connectivity.udpProbe(nas.nasname, 1812),
      this.connectivity.udpProbe(nas.nasname, 1813),
    ]);

    const auth = await this.connectivity.authProbe({
      host: radiusHost,
      port: radiusPort,
      secret: process.env.RADIUS_SHARED_SECRET ?? nas.secret,
      username: process.env.RADIUS_PROBE_USER ?? 'radius-probe',
      password: process.env.RADIUS_PROBE_PASSWORD ?? process.env.RADIUS_DEFAULT_PASSWORD ?? 'Probe#12345',
    });

    const networkStatus: NetworkStatus =
      authPort.status === 'reachable' || acctPort.status === 'reachable'
        ? 'reachable'
        : authPort.status === 'unreachable' && acctPort.status === 'unreachable'
          ? 'unreachable'
          : 'no-response';

    const parts = [
      networkStatus === 'reachable' ? 'NAS reachable' : networkStatus === 'unreachable' ? 'NAS unreachable' : 'NAS did not respond',
      acctPort.status === 'reachable' ? 'accounting (1813) reachable' : 'accounting (1813) no reply',
      auth.status === 'accept' ? 'RADIUS auth accepted' : auth.status === 'reject' ? 'RADIUS server up (probe user rejected)' : auth.status === 'no-response' ? 'RADIUS server did not respond' : 'RADIUS auth check failed',
    ];

    return {
      nasId: nas.id,
      nasname: nas.nasname,
      reachable: networkStatus === 'reachable',
      networkStatus,
      latencyMs: authPort.latencyMs ?? acctPort.latencyMs,
      accountingReachable: acctPort.status === 'reachable',
      authStatus: auth.status,
      authLatencyMs: auth.latencyMs,
      radiusServer: `${radiusHost}:${radiusPort}`,
      checkedAt: new Date().toISOString(),
      message: parts.join(' · '),
    };
  }
}
