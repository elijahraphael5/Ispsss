import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { TenantService } from '../../common/tenant/tenant.service';
import { AuditService } from '../audit-logs/audit.service';
import { NocGateway } from './gateways/noc.gateway';

@Injectable()
export class NocService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly gateway: NocGateway,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  async getDashboard() {
    const cached = await this.cache.get<any>('noc:dashboard');
    if (cached) return cached;

    const [devices, cpes] = await Promise.all([
      this.prisma.networkDevice.findMany(),
      this.prisma.cpe.findMany(),
    ]);

    const onlineDevices = devices.filter(d => d.status === 'ONLINE').length;
    const warningDevices = devices.filter(d => d.status === 'WARNING').length;
    const criticalDevices = devices.filter(d => d.status === 'CRITICAL').length;

    const cutoff = new Date(Date.now() - 90 * 1000);
    const staleDevices = devices.filter(d => d.updatedAt < cutoff && d.status !== 'OFFLINE' && d.status !== 'CRITICAL');

    const dashboard = {
      summary: {
        totalDevices: devices.length,
        onlineDevices,
        warningDevices,
        criticalDevices,
        totalCpes: cpes.length,
        onlineCpes: cpes.filter(c => c.status === 'ONLINE').length,
      },
      staleDevices,
      devices,
      cpes,
    };

    await this.cache.set('noc:dashboard', dashboard, 30);
    return dashboard;
  }

  async getDeviceLog(id: string) {
    return this.prisma.networkDevice.findUniqueOrThrow({ where: { id } });
  }

  async updateDeviceStatus(id: string, status: string) {
    const updated = await this.prisma.networkDevice.update({
      where: { id },
      data: { status: status as any, updatedAt: new Date() },
    });
    this.gateway.broadcastDeviceStatus(id, { status, updatedAt: updated.updatedAt });
    await this.cache.del('noc:dashboard');
    await this.audit.log({ action: 'DEVICE_STATUS_UPDATED', entityType: 'NetworkDevice', entityId: id, metadata: { status } });
    return updated;
  }

  async updateCpeStatus(id: string, status: string) {
    const updated = await this.prisma.cpe.update({
      where: { id },
      data: { status: status as any, lastSeenAt: new Date() },
    });
    await this.audit.log({ action: 'CPE_STATUS_UPDATED', entityType: 'Cpe', entityId: id, metadata: { status } });
    return updated;
  }

  async registerCpe(data: { subscriberId: string; macAddress: string; ipAddress?: string }) {
    const cpe = await this.prisma.cpe.create({
      data: {
        subscriberId: data.subscriberId,
        macAddress: data.macAddress,
        ipAddress: data.ipAddress,
      },
    });
    await this.audit.log({ action: 'CPE_CREATED', entityType: 'Cpe', entityId: cpe.id, metadata: { subscriberId: data.subscriberId, macAddress: data.macAddress } });
    return cpe;
  }

  async createDevice(data: { name: string; type: string; ipAddress: string; vendor?: string }) {
    const tenantId = await this.tenant.resolveTenant();
    const device = await this.prisma.networkDevice.create({ data: { tenantId, ...data } });
    await this.audit.log({ action: 'DEVICE_CREATED', entityType: 'NetworkDevice', entityId: device.id, metadata: { name: data.name, type: data.type, ipAddress: data.ipAddress } });
    return device;
  }
}
