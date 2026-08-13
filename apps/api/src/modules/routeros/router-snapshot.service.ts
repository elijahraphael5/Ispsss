import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { RouterOsService } from './routeros.service';

function parseQueueBytes(raw: string | null | undefined): bigint | null {
  if (!raw) return null;
  const parts = String(raw).split('/');
  let sum = 0n;
  for (const p of parts) {
    const n = BigInt(p.trim() || '0');
    sum += n;
  }
  return sum > 0n ? sum : null;
}

function parsePeakRateBps(raw: string | null | undefined): bigint {
  if (!raw) return 0n;
  const parts = String(raw).split('/').map(p => BigInt(p.trim() || '0'));
  let peak = 0n;
  for (const p of parts) if (p > peak) peak = p;
  return peak;
}

function parsePeakRatesBps(raw: string | null | undefined): { downBps: bigint; upBps: bigint } {
  if (!raw) return { downBps: 0n, upBps: 0n };
  const parts = String(raw).split('/').map(p => BigInt(p.trim() || '0'));
  const down = parts[0] ?? 0n;
  const up = parts[1] ?? 0n;
  return { downBps: down < 0n ? 0n : down, upBps: up < 0n ? 0n : up };
}

@Injectable()
export class RouterSnapshotService implements OnModuleInit {
  private readonly logger = new Logger(RouterSnapshotService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ros: RouterOsService,
  ) {}

  onModuleInit() {
    const ms = parseInt(process.env.ROUTER_SNAPSHOT_INTERVAL_MS || '30000', 10);
    if (!ms || ms <= 0) return;
    this.timer = setInterval(() => this.snapshotAll().catch(() => {}), ms);
    this.timer.unref?.();
    setTimeout(() => this.snapshotAll().catch(() => {}), 2000);
  }

  private async resolveTenantId(): Promise<string | undefined> {
    return TenantContext.getTenantId() ?? (await this.prisma.tenant.findFirst({ select: { id: true } }))?.id;
  }

  async snapshotAll() {
    if (this.running) return;
    this.running = true;
    try {
      const tenantId = await this.resolveTenantId();
      if (!tenantId) return;
      const device = await this.prisma.networkDevice.findFirst({
        where: { tenantId, routerosUsername: { not: null } },
        orderBy: { updatedAt: 'desc' },
      });
      if (!device?.id) return;
      let secrets;
      try {
        secrets = await this.ros.getPppSecrets(device.id);
      } catch (e) {
        const [snapCount, cpeCount] = await Promise.all([
          this.prisma.routerSnapshot.updateMany({
            where: { tenantId, deviceId: device.id },
            data: { isOnline: false, capturedAt: new Date() },
          }),
          this.prisma.cpe.updateMany({
            where: { connectionType: 'STATIC_IP', subscriber: { tenantId } },
            data: { status: 'OFFLINE', lastSeenAt: new Date() },
          }),
        ]);
        this.logger.warn(`RouterOS unreachable (device ${device.id}) — marked ${snapCount.count} PPPoE + ${cpeCount.count} static connections offline, data kept`);
        return;
      }
      const restored = await this.prisma.cpe.updateMany({
        where: { connectionType: 'STATIC_IP', status: { not: 'ONLINE' }, subscriber: { tenantId } },
        data: { status: 'ONLINE', lastSeenAt: new Date() },
      });
      if (restored.count > 0) this.logger.log(`RouterOK — restored ${restored.count} static connections to ONLINE`);
      let sessions: { name: string; address: string; [k: string]: unknown }[] = [];
      let queues: any[] = [];
      try { sessions = await this.ros.getActiveSessions(device.id); } catch { /* sessions optional */ }
      try { queues = await this.ros.getQueues(device.id); } catch { /* queues optional */ }
      const online = new Map(sessions.map(s => [s.name, s.address]));
      const sessionsByUser = new Map(sessions.map(s => [s.name, s]));
      const queueByKey = new Map<string, any>();
      for (const q of queues) {
        const keys = [q.name, q.target].filter(Boolean).map(String);
        for (const k of keys) {
          queueByKey.set(k, q);
          queueByKey.set(k.split('/')[0], q);
          const bare = k.toLowerCase().replace(/^<pppoe[- ]?/, '').replace(/>$/, '');
          if (bare !== k) queueByKey.set(bare, q);
        }
      }
      const queueFor = (username: string, ip: string | null | undefined): any =>
        queueByKey.get(String(ip || '')) ||
        queueByKey.get(username) ||
        queueByKey.get(username.toLowerCase()) ||
        queueByKey.get(`<pppoe-${username.toLowerCase()}>`) ||
        queueByKey.get(`<pppoe-${username}>`) ||
        null;
      let synced = 0;
      const now = new Date();
      for (const s of secrets) {
        const sess = sessionsByUser.get(s.username) || null;
        const queue = queueFor(s.username, sess?.address);
        const queueBytes = queue ? parseQueueBytes(queue?.['bytes'] ?? queue?.['total-bytes'] ?? null) : null;
        const peakRate = queue ? parsePeakRateBps(queue?.rate ?? null) : 0n;
        const { downBps, upBps } = queue ? parsePeakRatesBps(queue?.rate ?? null) : { downBps: 0n, upBps: 0n };
        let prevBytes: bigint | null = null;
        if (queueBytes !== null) {
          const prev = await this.prisma.routerMetric.findFirst({
            where: { tenantId, username: s.username },
            orderBy: { capturedAt: 'desc' },
            select: { queueBytes: true },
          });
          prevBytes = prev?.queueBytes ?? null;
        }
        let delta = 0n;
        if (queueBytes !== null && prevBytes !== null) {
          delta = queueBytes >= prevBytes ? queueBytes - prevBytes : queueBytes;
        }
        if (delta > 0n || peakRate > 0n) {
          const day = new Date(now);
          day.setUTCHours(0, 0, 0, 0);
          const dayRow = await this.prisma.routerUsageDay.upsert({
            where: { tenantId_deviceId_username_date: { tenantId, deviceId: device.id, username: s.username, date: day } },
            create: { tenantId, deviceId: device.id, username: s.username, date: day, usageBytes: delta, peakRateBps: peakRate, peakDownBps: downBps, peakUpBps: upBps },
            update: { usageBytes: { increment: delta } },
          });
          if (peakRate > 0n && dayRow.peakRateBps < peakRate) {
            await this.prisma.routerUsageDay.updateMany({ where: { id: dayRow.id, peakRateBps: { lt: peakRate } }, data: { peakRateBps: peakRate } });
          }
          if (downBps > 0n && dayRow.peakDownBps < downBps) {
            await this.prisma.routerUsageDay.updateMany({ where: { id: dayRow.id, peakDownBps: { lt: downBps } }, data: { peakDownBps: downBps } });
          }
          if (upBps > 0n && dayRow.peakUpBps < upBps) {
            await this.prisma.routerUsageDay.updateMany({ where: { id: dayRow.id, peakUpBps: { lt: upBps } }, data: { peakUpBps: upBps } });
          }
        }
        const routerData = {
          secretId: s.id,
          profile: s.plan,
          comment: s.customer,
          disabled: !s.active,
          lastCallerId: s.lastCallerId,
          lastLoggedOut: s.lastLoggedOut,
          lastDisconnectReason: s.lastDisconnectReason,
          ipAddress: sess?.address ?? null,
          isOnline: !!sess,
          raw: s as any,
          capturedAt: now,
        };
        await this.prisma.routerSnapshot.upsert({
          where: { tenantId_deviceId_username: { tenantId, deviceId: device.id, username: s.username } },
          create: { tenantId, deviceId: device.id, username: s.username, ...routerData },
          update: routerData,
        });
        await this.prisma.routerMetric.create({
          data: {
            tenantId,
            deviceId: device.id,
            username: s.username,
            isOnline: !!sess,
            ipAddress: sess?.address ?? null,
            profile: s.plan,
            comment: s.customer,
            disabled: !s.active,
            lastCallerId: s.lastCallerId,
            sessionId: sess ? String(sess['session-id'] || sess['.id'] || '') : null,
            sessionUptime: sess ? String(sess.uptime || '') : null,
            queueName: queue?.name ?? null,
            queueTarget: queue?.target ?? null,
            queueMaxLimit: queue?.['max-limit'] ?? null,
            queueBytes,
            queueRate: queue?.['rate'] ?? null,
            raw: { secret: s, session: sess, queue } as any,
            capturedAt: now,
          },
        });
        synced++;
      }
      const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      const pruned = await this.prisma.routerMetric.deleteMany({ where: { tenantId, capturedAt: { lt: cutoff } } });
      let arpChanges = 0;
      try {
        const arp = await this.ros.getArpEntries(device.id);
        const arpIps = new Set(arp.map(e => `ARP-${String(e.address || '')}`));
        const tracked = await this.prisma.routerMetric.findMany({
          where: { tenantId, username: { startsWith: 'ARP-' } },
          distinct: ['username'],
          select: { username: true },
        });
        for (const e of arp) {
          const ip = String(e.address || '');
          if (!ip) continue;
          const uname = `ARP-${ip}`;
          const last = await this.prisma.routerMetric.findFirst({
            where: { tenantId, username: uname },
            orderBy: { capturedAt: 'desc' },
            select: { isOnline: true },
          });
          if (last?.isOnline) continue;
          await this.prisma.routerMetric.create({
            data: {
              tenantId,
              deviceId: device.id,
              username: uname,
              isOnline: true,
              ipAddress: ip,
              comment: String(e['host-name'] || e['mac-address'] || ''),
              raw: e as any,
              capturedAt: now,
            },
          });
          arpChanges++;
        }
        for (const t of tracked) {
          if (arpIps.has(t.username)) continue;
          const last = await this.prisma.routerMetric.findFirst({
            where: { tenantId, username: t.username },
            orderBy: { capturedAt: 'desc' },
            select: { isOnline: true },
          });
          if (last?.isOnline) {
            await this.prisma.routerMetric.create({
              data: {
                tenantId,
                deviceId: device.id,
                username: t.username,
                isOnline: false,
                ipAddress: t.username.replace(/^ARP-/, ''),
                capturedAt: now,
              },
            });
            arpChanges++;
          }
        }
      } catch { /* arp tracking optional */ }
      this.logger.log(`Snapshot synced ${synced} secrets from ${device.name} (${device.ipAddress}), pruned ${pruned.count} old metrics, ${arpChanges} ARP state changes`);
    } catch (e: any) {
      this.logger.warn(`Snapshot sync failed: ${e.message}`);
    } finally {
      this.running = false;
    }
  }

  async listSnapshots() {
    const tenantId = await this.resolveTenantId();
    const rows = await this.prisma.routerSnapshot.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { username: 'asc' },
    });
    return rows.map(r => ({
      id: r.id,
      username: r.username,
      customer: r.comment || '',
      profile: r.profile,
      plan: r.plan,
      active: !r.disabled,
      lastCallerId: r.lastCallerId,
      lastDisconnectReason: r.lastDisconnectReason,
      lastLoggedOut: r.lastLoggedOut,
      ipAddress: r.ipAddress,
      isOnline: r.isOnline,
      name: r.name,
      email: r.email,
      phone: r.phone,
      address: r.address,
      installerName: r.installerName,
      dueAt: r.dueAt,
      capturedAt: r.capturedAt,
      cached: true,
    }));
  }

  async listMetrics(username?: string, ip?: string, limit = 60) {
    const tenantId = await this.resolveTenantId();
    const rows = await this.prisma.routerMetric.findMany({
      where: { tenantId, ...(username ? { username } : {}), ...(ip ? { ipAddress: ip } : {}) },
      orderBy: { capturedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    return rows.map(r => ({
      id: r.id,
      username: r.username,
      isOnline: r.isOnline,
      ipAddress: r.ipAddress,
      profile: r.profile,
      disabled: r.disabled,
      sessionId: r.sessionId,
      sessionUptime: r.sessionUptime,
      queueName: r.queueName,
      queueTarget: r.queueTarget,
      queueMaxLimit: r.queueMaxLimit,
      queueBytes: r.queueBytes?.toString() ?? null,
      queueRate: r.queueRate,
      capturedAt: r.capturedAt,
    }));
  }

  async listUsage(username: string, range: string) {
    const tenantId = await this.resolveTenantId();
    const where = { tenantId, username };
    const now = new Date();
    if (range === 'daily') {
      const start = new Date(now);
      start.setUTCHours(0, 0, 0, 0);
      const rows = await this.prisma.routerMetric.findMany({
        where: { ...where, capturedAt: { gte: start }, queueBytes: { not: null } },
        orderBy: { capturedAt: 'asc' },
        select: { capturedAt: true, queueBytes: true },
      });
      const buckets = new Map<string, bigint>();
      let prev: bigint | null = null;
      for (const r of rows) {
        const key = String(r.capturedAt.getUTCHours()).padStart(2, '0') + ':00';
        const cur = r.queueBytes;
        let delta = 0n;
        if (cur !== null && prev !== null) delta = cur >= prev ? cur - prev : cur;
        buckets.set(key, (buckets.get(key) ?? 0n) + delta);
        if (cur !== null) prev = cur;
      }
      return [...buckets.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([bucket, usageBytes]) => ({ bucket, usageBytes: usageBytes.toString(), peakRateBps: 0 }));
    }
    const rangeDays: Record<string, number> = { weekly: 7, monthly: 30, yearly: 365 };
    const start = new Date(now.getTime() - (rangeDays[range] ?? 7) * 86400000);
    const days = await this.prisma.routerUsageDay.findMany({
      where: { ...where, date: { gte: start } },
      orderBy: { date: 'asc' },
    });
    if (range === 'yearly') {
      const months = new Map<string, { usageBytes: bigint; peakRateBps: bigint; peakDownBps: bigint; peakUpBps: bigint }>();
      for (const d of days) {
        const key = d.date.toISOString().slice(0, 7);
        const m = months.get(key) ?? { usageBytes: 0n, peakRateBps: 0n, peakDownBps: 0n, peakUpBps: 0n };
        m.usageBytes += d.usageBytes;
        if (d.peakRateBps > m.peakRateBps) m.peakRateBps = d.peakRateBps;
        if (d.peakDownBps > m.peakDownBps) m.peakDownBps = d.peakDownBps;
        if (d.peakUpBps > m.peakUpBps) m.peakUpBps = d.peakUpBps;
        months.set(key, m);
      }
      return [...months.entries()].map(([bucket, v]) => ({
        bucket,
        usageBytes: v.usageBytes.toString(),
        peakRateBps: v.peakRateBps.toString(),
        peakDownBps: v.peakDownBps.toString(),
        peakUpBps: v.peakUpBps.toString(),
      }));
    }
    return days.map(d => ({
      bucket: d.date.toISOString().slice(0, 10),
      usageBytes: d.usageBytes.toString(),
      peakRateBps: d.peakRateBps.toString(),
      peakDownBps: d.peakDownBps.toString(),
      peakUpBps: d.peakUpBps.toString(),
    }));
  }

  async updateProfile(username: string, data: { name?: string; email?: string; phone?: string; address?: string; installerName?: string; plan?: string; dueAt?: string | null }) {
    const tenantId = await this.resolveTenantId();
    const row = await this.prisma.routerSnapshot.findFirst({ where: tenantId ? { tenantId, username } : { username } });
    if (!row) throw new NotFoundException(`No snapshot for "${username}"`);
    return this.prisma.routerSnapshot.update({
      where: { id: row.id },
      data: {
        ...(data.name !== undefined ? { name: data.name || null } : {}),
        ...(data.email !== undefined ? { email: data.email || null } : {}),
        ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
        ...(data.address !== undefined ? { address: data.address || null } : {}),
        ...(data.installerName !== undefined ? { installerName: data.installerName || null } : {}),
        ...(data.plan !== undefined ? { plan: data.plan || null } : {}),
        ...(data.dueAt !== undefined ? { dueAt: data.dueAt ? new Date(data.dueAt) : null } : {}),
      },
    });
  }
}
