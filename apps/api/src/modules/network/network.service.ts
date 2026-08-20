import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantService } from '../../common/tenant/tenant.service';
import { AuditService } from '../audit-logs/audit.service';

@Injectable()
export class NetworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  // ── Dashboard ──────────────────────────────────────────────

  async getDashboard() {
    const [
      totalSubs, activeSubs, suspendedSubs,
    ] = await Promise.all([
      this.prisma.subscriber.count({ where: { deletedAt: null } }),
      this.prisma.subscriber.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.subscriber.count({ where: { status: 'SUSPENDED', deletedAt: null } }),
    ]);

    return {
      totalSubscribers: totalSubs,
      activeSubscribers: activeSubs,
      inactiveSubscribers: totalSubs - activeSubs - suspendedSubs,
      suspendedSubscribers: suspendedSubs,
    };
  }

  // ── Network Devices ───────────────────────────────────────

  async findAllDevices() {
    return this.prisma.networkDevice.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  async findDevice(id: string) {
    const d = await this.prisma.networkDevice.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Device not found');
    return d;
  }

  async createDevice(data: { name: string; type: string; ipAddress: string; vendor?: string; location?: string; secret?: string }) {
    const tenantId = await this.tenant.resolveTenant();
    const device = await this.prisma.networkDevice.create({ data: { tenantId, ...data } });
    await this.audit.log({ action: 'DEVICE_CREATED', entityType: 'NetworkDevice', entityId: device.id, metadata: { name: data.name, type: data.type, ipAddress: data.ipAddress } });
    return device;
  }

  async updateDevice(id: string, data: any) {
    const device = await this.prisma.networkDevice.update({ where: { id }, data });
    await this.audit.log({ action: 'DEVICE_UPDATED', entityType: 'NetworkDevice', entityId: id, metadata: { ...data } });
    return device;
  }

  // ── PPPoE Sessions ────────────────────────────────────────

  async listSessions(filters?: { active?: boolean; username?: string }) {
    const where: any = {};
    if (filters?.active !== undefined) where.isActive = filters.active;
    if (filters?.username) where.username = { contains: filters.username, mode: 'insensitive' };
    const rows = await this.prisma.pppoeSession.findMany({
      where,
      orderBy: { lastSyncedAt: 'desc' },
    });
    return rows.map(s => ({
      id: s.id,
      username: s.username,
      sessionId: s.sessionId,
      nasIpAddress: s.nasIpAddress,
      nasName: s.nasName,
      callerId: s.callerId,
      callingStationId: s.callingStationId,
      framedIpAddress: s.framedIpAddress,
      assignedPool: s.assignedPool,
      profile: s.profile,
      serviceType: s.serviceType,
      startTime: s.startTime,
      sessionDuration: s.sessionDuration,
      downloadBytes: Number(s.downloadBytes ?? 0),
      uploadBytes: Number(s.uploadBytes ?? 0),
      downloadRate: s.downloadRate,
      uploadRate: s.uploadRate,
      subscriberId: s.subscriberId,
      isActive: s.isActive,
      lastSyncedAt: s.lastSyncedAt,
    }));
  }

  async disconnectSession(id: string) {
    const session = await this.prisma.pppoeSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Session not found');
    return this.prisma.pppoeSession.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ── Unified Connections (PPPoE + Static IP) ────────────

  async getBandwidth(range: 'hourly' | 'daily' | 'monthly' = 'hourly') {
    const sessions = await this.prisma.pppoeSession.findMany({
      where: { isActive: true },
      select: { downloadBytes: true, uploadBytes: true, startTime: true, lastSyncedAt: true },
    });

    const now = new Date();
    const keyOf = (d: Date) => {
      if (range === 'hourly') return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
      if (range === 'daily') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    };
    const fmt = (ts: number) => {
      const d = new Date(ts);
      if (range === 'hourly') return `${String(d.getHours()).padStart(2, '0')}:00`;
      if (range === 'daily') return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      return `${d.toLocaleString('en-US', { month: 'short' })} ${String(d.getFullYear()).slice(2)}`;
    };

    const buckets = new Map<number, { download: number; upload: number }>();
    for (const s of sessions) {
      const t = s.startTime ?? s.lastSyncedAt;
      const k = keyOf(t);
      const cur = buckets.get(k) ?? { download: 0, upload: 0 };
      cur.download += Number(s.downloadBytes ?? 0);
      cur.upload += Number(s.uploadBytes ?? 0);
      buckets.set(k, cur);
    }

    const count = range === 'hourly' ? 24 : range === 'daily' ? 7 : 12;
    const bucketSeconds = range === 'hourly' ? 3600 : range === 'daily' ? 86400 : 2_592_000;
    const points: { time: string; download: number; upload: number }[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
      if (range === 'hourly') d.setHours(d.getHours() - i);
      else if (range === 'daily') d.setDate(d.getDate() - i);
      else d.setMonth(d.getMonth() - i);
      const b = buckets.get(keyOf(d));
      points.push({
        time: fmt(d.getTime()),
        download: Math.round((b?.download ?? 0) / bucketSeconds),
        upload: Math.round((b?.upload ?? 0) / bucketSeconds),
      });
    }
    return points;
  }

  async getAllConnections() {
    const [pppoeSessions, staticCpes] = await Promise.all([
      this.prisma.pppoeSession.findMany({
        where: { isActive: true },
        orderBy: { lastSyncedAt: 'desc' },
        take: 200,
      }),
      this.prisma.cpe.findMany({
        where: { connectionType: 'STATIC_IP' },
        include: { subscriber: { include: { user: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
    ]);

    const pppoeConnections = pppoeSessions.map(s => ({
      id: s.id,
      type: 'PPPOE' as const,
      username: s.username,
      ipAddress: s.framedIpAddress,
      macAddress: null,
      nasIpAddress: s.nasIpAddress,
      status: s.isActive ? 'ACTIVE' : 'OFFLINE',
      duration: s.sessionDuration,
      downloadBytes: s.downloadBytes?.toString() ?? '0',
      uploadBytes: s.uploadBytes?.toString() ?? '0',
      lastSeen: s.lastSyncedAt,
      subscriberName: null,
      subscriberId: null,
    }));

    const staticConnections = staticCpes.map(c => ({
      id: c.id,
      type: 'STATIC_IP' as const,
      username: c.name?.startsWith('ARP-') ? null : (c.subscriber?.user?.email ?? null),
      ipAddress: c.ipAddress,
      macAddress: c.macAddress,
      nasIpAddress: null,
      status: c.status === 'ONLINE' ? 'ACTIVE' : c.status,
      duration: null,
      downloadBytes: '0',
      uploadBytes: '0',
      lastSeen: c.lastSeenAt,
      subscriberName: c.name?.startsWith('ARP-') ? null : c.name,
      subscriberId: c.subscriberId,
    }));

    return {
      connections: [...pppoeConnections, ...staticConnections].sort(
        (a, b) => new Date(b.lastSeen ?? 0).getTime() - new Date(a.lastSeen ?? 0).getTime(),
      ),
      totalPppoe: pppoeConnections.length,
      totalStatic: staticConnections.length,
    };
  }

  // ── CPE / IP Management ──────────────────────────────────

  async listCpes(subscriberId: string) {
    return this.prisma.cpe.findMany({ where: { subscriberId }, orderBy: { createdAt: 'desc' } });
  }

  async createCpe(subscriberId: string, data: { name?: string; ipAddress: string; macAddress?: string; connectionType?: 'PPPOE' | 'STATIC_IP' }) {
    const cpe = await this.prisma.cpe.create({
      data: {
        subscriberId,
        name: data.name ?? null,
        macAddress: data.macAddress ?? `00:${Array.from({ length: 5 }, () => Math.floor(Math.random() * 100).toString(16).padStart(2, '0')).join(':')}`,
        ipAddress: data.ipAddress,
        status: 'OFFLINE',
        connectionType: data.connectionType ?? 'STATIC_IP',
      },
    });
    await this.audit.log({ action: 'CPE_CREATED', entityType: 'Cpe', entityId: cpe.id, metadata: { subscriberId, macAddress: cpe.macAddress, ipAddress: data.ipAddress } });
    return cpe;
  }

  async updateCpe(id: string, data: { name?: string; ipAddress?: string }) {
    const cpe = await this.prisma.cpe.update({ where: { id }, data });
    await this.audit.log({ action: 'CPE_UPDATED', entityType: 'Cpe', entityId: id, metadata: data as any });
    return cpe;
  }

  async deleteCpe(id: string) {
    await this.prisma.cpe.delete({ where: { id } });
    await this.audit.log({ action: 'CPE_DELETED', entityType: 'Cpe', entityId: id });
  }
}
