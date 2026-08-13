import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RouterOsService } from '../routeros/routeros.service';

@Injectable()
export class RouterHealthService {
  constructor(private readonly prisma: PrismaService, private readonly routeros: RouterOsService) {}

  async checkDevice(deviceId: string) {
    const device = await this.prisma.networkDevice.findUniqueOrThrow({ where: { id: deviceId } });
    if (!device.routerosUsername || !device.routerosPassword) return;
    try {
      await this.routeros.getSystemResource(device.id);
      await this.prisma.routerHealth.upsert({
        where: { deviceId },
        update: { linkStatus: 'up', lastSeenAt: new Date(), lastError: null },
        create: { deviceId, linkStatus: 'up', lastSeenAt: new Date() },
      });
    } catch (err: any) {
      await this.prisma.routerHealth.upsert({
        where: { deviceId },
        update: { linkStatus: 'unreachable', lastErrorAt: new Date(), lastError: err?.message ?? 'Unknown error' },
        create: { deviceId, linkStatus: 'unreachable', lastErrorAt: new Date(), lastError: err?.message ?? 'Unknown error' },
      });
    }
  }

  async checkAll() {
    const devices = await this.prisma.networkDevice.findMany();
    await Promise.all(devices.map(d => this.checkDevice(d.id)));
  }
}
