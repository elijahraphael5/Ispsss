import { Injectable, NotFoundException, BadRequestException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

export interface RouterOsQueue {
  '.id': string;
  name: string;
  target: string;
  'max-limit': string;
  'burst-limit'?: string;
  'burst-threshold'?: string;
  'burst-time'?: string;
  'rate-limit'?: string;
  priority?: string;
  queue?: string;
  disabled: string;
  bytes: string;
  packets: string;
  rate: string;
  'total-bytes'?: string;
  'total-packets'?: string;
  'total-rate'?: string;
  [key: string]: any;
}

export interface RouterOsSession {
  '.id': string;
  name: string;
  service: string;
  'caller-id': string;
  address: string;
  uptime: string;
  'session-id': string;
  encoding?: string;
  'limit-bytes-in'?: string;
  'limit-bytes-out'?: string;
  radius?: string;
  comment?: string;
  [key: string]: any;
}

@Injectable()
export class RouterOsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getDevice(deviceId: string) {
    const device = await this.prisma.networkDevice.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Device not found');
    if (!device.routerosUsername || !device.routerosPassword) {
      throw new BadRequestException('Device is not configured as a RouterOS device (missing username/password)');
    }
    return device;
  }

  private baseUrl(ip: string, port: number | null): string {
    const p = port ?? 80;
    return `http${p === 443 ? 's' : ''}://${ip}:${p}/rest`;
  }

  private authHeader(username: string, password: string): string {
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  private async fetch<T>(
    deviceIp: string,
    devicePort: number | null,
    username: string,
    password: string,
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl(deviceIp, devicePort)}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader(username, password),
        ...(options.headers as Record<string, string>),
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      let msg: string;
      try { const j = await res.json(); msg = j.error || j.message || res.statusText; } catch { msg = await res.text(); }
      throw new BadRequestException(`RouterOS error (${res.status}): ${msg}`);
    }
    return res.json();
  }

  // ─── Queue Simple ─────────────────────────────────────────────

  async getQueues(deviceId: string): Promise<RouterOsQueue[]> {
    const device = await this.getDevice(deviceId);
    return this.fetch<RouterOsQueue[]>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/queue/simple');
  }

  async createQueue(deviceId: string, data: Record<string, any>): Promise<RouterOsQueue> {
    const device = await this.getDevice(deviceId);
    return this.fetch<RouterOsQueue>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/queue/simple', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updateQueue(deviceId: string, queueId: string, data: Record<string, any>): Promise<RouterOsQueue> {
    const device = await this.getDevice(deviceId);
    return this.fetch<RouterOsQueue>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, `/queue/simple/${queueId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteQueue(deviceId: string, queueId: string): Promise<void> {
    const device = await this.getDevice(deviceId);
    await this.fetch<void>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, `/queue/simple/${queueId}`, {
      method: 'DELETE',
    });
  }

  // ─── Bandwidth Stats (aggregate from all queues) ──────────────

  async getBandwidthStats(deviceId: string) {
    const queues = await this.getQueues(deviceId);
    let totalBytesDown = 0;
    let totalBytesUp = 0;
    let totalRateDown = 0;
    let totalRateUp = 0;

    for (const q of queues) {
      const [bytesDown, bytesUp] = (q.bytes || '0/0').split('/').map(Number);
      const [rateDown, rateUp] = (q.rate || '0/0').split('/').map(Number);
      totalBytesDown += bytesDown;
      totalBytesUp += bytesUp;
      totalRateDown += rateDown;
      totalRateUp += rateUp;
    }

    return {
      deviceId,
      queueCount: queues.length,
      totalBytesDown,
      totalBytesUp,
      totalBytes: totalBytesDown + totalBytesUp,
      totalRateDown,
      totalRateUp,
      totalRate: totalRateDown + totalRateUp,
      queues: queues.map(q => ({
        id: q['.id'],
        name: q.name,
        target: q.target,
        maxLimit: q['max-limit'],
        disabled: q.disabled === 'true',
        bytesDown: Number(q.bytes?.split('/')[0] || 0),
        bytesUp: Number(q.bytes?.split('/')[1] || 0),
        rateDown: Number(q.rate?.split('/')[0] || 0),
        rateUp: Number(q.rate?.split('/')[1] || 0),
      })),
    };
  }

  async getAllDevicesBandwidth() {
    const devices = await this.prisma.networkDevice.findMany({
      where: { routerosUsername: { not: null }, routerosPassword: { not: null } },
    });
    const results = await Promise.allSettled(
      devices.map(d => this.getBandwidthStats(d.id)),
    );
    let totalBytesDown = 0;
    let totalBytesUp = 0;
    let totalRateDown = 0;
    let totalRateUp = 0;
    let totalQueues = 0;
    const deviceStats: any[] = [];

    for (const r of results) {
      if (r.status === 'fulfilled') {
        totalBytesDown += r.value.totalBytesDown;
        totalBytesUp += r.value.totalBytesUp;
        totalRateDown += r.value.totalRateDown;
        totalRateUp += r.value.totalRateUp;
        totalQueues += r.value.queueCount;
        deviceStats.push(r.value);
      }
    }

    return { totalBytesDown, totalBytesUp, totalBytes: totalBytesDown + totalBytesUp, totalRateDown, totalRateUp, totalRate: totalRateDown + totalRateUp, totalQueues, deviceStats };
  }

  // ─── Active PPPoE Sessions ────────────────────────────────────

  async getActiveSessions(deviceId: string): Promise<RouterOsSession[]> {
    const device = await this.getDevice(deviceId);
    return this.fetch<RouterOsSession[]>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/ppp/active');
  }

  async syncSessions(deviceId: string) {
    const device = await this.getDevice(deviceId);
    const activeSessions = await this.fetch<RouterOsSession[]>(
      device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/ppp/active',
    );

    let created = 0;
    let updated = 0;

    for (const s of activeSessions) {
      const sessionId = s['session-id'] || s['.id'];
      const existing = await this.prisma.pppoeSession.findUnique({ where: { sessionId } });

      const data = {
        username: s.name,
        nasIpAddress: device.ipAddress,
        nasName: device.name,
        callerId: s['caller-id'] || null,
        callingStationId: s['caller-id'] || null,
        framedIpAddress: s.address || null,
        assignedPool: null,
        profile: s.comment || null,
        serviceType: s.service || null,
        startTime: new Date(),
        sessionDuration: this.parseUptime(s.uptime),
        downloadBytes: BigInt(s['limit-bytes-out'] || 0),
        uploadBytes: BigInt(s['limit-bytes-in'] || 0),
        isActive: true,
        lastSyncedAt: new Date(),
      };

      if (existing) {
        await this.prisma.pppoeSession.update({ where: { sessionId }, data });
        updated++;
      } else {
        await this.prisma.pppoeSession.create({ data: { ...data, sessionId } });
        created++;
      }
    }

    // Mark sessions not in the active list as inactive
    const activeSessionIds = activeSessions.map(s => s['session-id'] || s['.id']);
    const deactivated = await this.prisma.pppoeSession.updateMany({
      where: { isActive: true, sessionId: { notIn: activeSessionIds } },
      data: { isActive: false, lastSyncedAt: new Date() },
    });

    return { created, updated, deactivated: deactivated.count, total: activeSessions.length };
  }

  // ─── PPPoE Disconnect / Sessions ────────────────────────────

  async disconnectSession(deviceId: string, sessionId: string) {
    const device = await this.getDevice(deviceId);
    await this.fetch<void>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, `/ppp/active/${sessionId}`, { method: 'DELETE' });
    return { ok: true, sessionId };
  }

  // ─── DHCP Leases ────────────────────────────────────────────

  async getDhcpLeases(deviceId: string) {
    const device = await this.getDevice(deviceId);
    return this.fetch<any[]>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/ip/dhcp-server/lease');
  }

  // ─── Firewall Address Lists ─────────────────────────────────

  async getAddressLists(deviceId: string) {
    const device = await this.getDevice(deviceId);
    return this.fetch<any[]>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/ip/firewall/address-list');
  }

  async addAddressListEntry(deviceId: string, data: { address: string; list: string; comment?: string }) {
    const device = await this.getDevice(deviceId);
    return this.fetch<any>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/ip/firewall/address-list', {
      method: 'PUT',
      body: JSON.stringify({ address: data.address, list: data.list, comment: data.comment || '' }),
    });
  }

  async removeAddressListEntry(deviceId: string, listId: string) {
    const device = await this.getDevice(deviceId);
    await this.fetch<void>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, `/ip/firewall/address-list/${listId}`, { method: 'DELETE' });
    return { ok: true, listId };
  }

  // ─── Wireless Clients ───────────────────────────────────────

  async getWirelessClients(deviceId: string) {
    const device = await this.getDevice(deviceId);
    try {
      return await this.fetch<any[]>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/interface/wireless/registration-table');
    } catch {
      return this.fetch<any[]>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/interface/wifi/registration-table');
    }
  }

  // ─── PPP Profiles / System Health / Logs ────────────────────

  async getPppProfiles(deviceId: string) {
    const device = await this.getDevice(deviceId);
    return this.fetch<any[]>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/ppp/profile');
  }

  async getSystemHealth(deviceId: string) {
    const device = await this.getDevice(deviceId);
    try {
      return await this.fetch<any[]>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/system/health');
    } catch {
      return [];
    }
  }

  async getLogs(deviceId: string, limit = 100) {
    const device = await this.getDevice(deviceId);
    const logs = await this.fetch<any[]>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/log');
    return logs.slice(-limit);
  }

  // ─── IP Addresses / Routes / Pools ──────────────────────────

  async getIpAddresses(deviceId: string) {
    const device = await this.getDevice(deviceId);
    return this.fetch<any[]>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/ip/address');
  }

  async getRoutes(deviceId: string) {
    const device = await this.getDevice(deviceId);
    return this.fetch<any[]>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/ip/route');
  }

  async getPools(deviceId: string) {
    const device = await this.getDevice(deviceId);
    return this.fetch<any[]>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/ip/pool');
  }

  // ─── Ping ───────────────────────────────────────────────────

  async pingAddress(deviceId: string, address: string, count = 3) {
    const device = await this.getDevice(deviceId);
    return this.fetch<any>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/tool/ping', {
      method: 'POST',
      body: JSON.stringify({ address, count }),
    });
  }

  // ─── PPP Secrets (subscribers) ──────────────────────────────
  async getPppSecrets(deviceId: string) {
    const device = await this.getDevice(deviceId);
    const secrets = await this.fetch<any[]>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/ppp/secret');
    return secrets.map(s => ({
      id: s['.id'],
      username: s.name,
      customer: s.comment || '',
      plan: s.profile,
      active: s.disabled === 'false',
      service: s.service,
      lastCallerId: s['last-caller-id'] || null,
      lastDisconnectReason: s['last-disconnect-reason'] || null,
      lastLoggedOut: s['last-logged-out'] || null,
      limitBytesIn: s['limit-bytes-in'] || '0',
      limitBytesOut: s['limit-bytes-out'] || '0',
    }));
  }

  async createPppSecret(deviceId: string, data: { name: string; password: string; profile: string; comment?: string; service?: string }) {
    const device = await this.getDevice(deviceId);
    return this.fetch<any>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/ppp/secret', {
      method: 'PUT',
      body: JSON.stringify({
        name: data.name,
        password: data.password,
        profile: data.profile,
        comment: data.comment || '',
        service: data.service || 'pppoe',
        disabled: 'no',
      }),
    });
  }

  async updatePppSecret(deviceId: string, secretId: string, data: { name?: string; password?: string; profile?: string; comment?: string; disabled?: string }) {
    const device = await this.getDevice(deviceId);
    const body: any = {};
    if (data.name) body.name = data.name;
    if (data.password) body.password = data.password;
    if (data.profile) body.profile = data.profile;
    if (data.comment !== undefined) body.comment = data.comment;
    if (data.disabled) body.disabled = data.disabled;
    return this.fetch<any>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, `/ppp/secret/${secretId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  async deletePppSecret(deviceId: string, secretId: string) {
    const device = await this.getDevice(deviceId);
    await this.fetch<void>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, `/ppp/secret/${secretId}`, {
      method: 'DELETE',
    });
  }

  // ─── System Resource Info ────────────────────────────────────

  async getSystemResource(deviceId: string) {
    const device = await this.getDevice(deviceId);
    return this.fetch<any>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/system/resource');
  }

  async getInterfaces(deviceId: string) {
    const device = await this.getDevice(deviceId);
    return this.fetch<any[]>(device.ipAddress, device.routerosPort, device.routerosUsername!, device.routerosPassword!, '/interface');
  }

  // ─── Static IP / ARP Sync ─────────────────────────────────────

  private async resolveArpDevice(deviceId?: string) {
    if (deviceId) return this.getDevice(deviceId);
    const device = await this.prisma.networkDevice.findFirst({
      where: { routerosUsername: { not: null }, routerosPassword: { not: null } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!device) throw new BadRequestException('No RouterOS-configured device found. Create a network device with RouterOS credentials first.');
    return device;
  }

  private async arpFetch<T>(device: { ipAddress: string; routerosPort: number | null; routerosUsername: string | null; routerosPassword: string | null }, path: string): Promise<T> {
    const port = device.routerosPort ?? 80;
    const protocol = port === 443 ? 'https:' : 'http:';
    const url = `${protocol}//${device.ipAddress}:${port}/rest${path}`;
    const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from(`${device.routerosUsername}:${device.routerosPassword}`).toString('base64'),
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        let msg: string;
        try { const j = await res.json(); msg = j.error || j.message || res.statusText; } catch { msg = await res.text(); }
        throw new BadRequestException(`RouterOS error (${res.status}): ${msg}`);
      }
      return res.json();
    } finally {
      if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    }
  }

  async getArpEntries(deviceId?: string): Promise<any[]> {
    const device = await this.resolveArpDevice(deviceId);
    return this.arpFetch<any[]>(device, '/ip/arp?status=reachable');
  }

  async syncArpToSubscribers(deviceId?: string) {
    const device = await this.resolveArpDevice(deviceId);
    const entries = await this.arpFetch<any[]>(device, '/ip/arp?status=reachable');
    let created = 0;
    let skipped = 0;

    const tenant = await this.prisma.tenant.findFirst({ where: { slug: 'default' } });
    const tenantId = tenant?.id ?? 'default';
    const customerRole = await this.prisma.customRole.findFirst({ where: { name: 'CUSTOMER' } });

    for (const entry of entries) {
      const mac = entry['mac-address'] || '';
      const ip = entry.address || '';

      if (!mac && !ip) { skipped++; continue; }

      const existingCpe = await this.prisma.cpe.findFirst({
        where: {
          OR: [
            ...(mac ? [{ macAddress: mac }] : []),
            ...(ip ? [{ ipAddress: ip }] : []),
          ],
        },
      });
      if (existingCpe) { skipped++; continue; }

      const email = `static-${ip.replace(/\./g, '-')}@lan`;
      const passwordHash = await bcrypt.hash(Math.random().toString(36).slice(2), 10);
      const user = await this.prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          email,
          passwordHash,
          tenantId,
          isSuperAdmin: false,
          customRoleId: customerRole?.id ?? undefined,
        },
      });

      const subscriber = await this.prisma.subscriber.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          tenantId,
          userId: user.id,
          type: 'RESIDENTIAL',
          status: 'ACTIVE',
          address: `Static IP: ${ip}`,
        },
      });

      await this.prisma.cpe.create({
        data: {
          subscriberId: subscriber.id,
          macAddress: mac || `00:${ip.replace(/\./g, ':')}`,
          ipAddress: ip,
          status: 'ONLINE',
          connectionType: 'STATIC_IP',
          name: `ARP-${ip}`,
        },
      });

      created++;
    }

    return { created, skipped, total: entries.length };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private parseUptime(uptime: string): number {
    // RouterOS uptime format: "1d2h3m4s" or "2h3m4s" or "3m4s" or "4s"
    let total = 0;
    const m = uptime.match(/(\d+)d/);
    if (m) total += parseInt(m[1]) * 86400;
    const h = uptime.match(/(\d+)h/);
    if (h) total += parseInt(h[1]) * 3600;
    const min = uptime.match(/(\d+)m/);
    if (min) total += parseInt(min[1]) * 60;
    const sec = uptime.match(/(\d+)s/);
    if (sec) total += parseInt(sec[1]);
    return total;
  }
}
