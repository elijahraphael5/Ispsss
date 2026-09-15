import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RouterOsService } from './routeros.service';

@Injectable()
export class ActionQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly routeros: RouterOsService) {}

  async suspend(deviceId: string, secretId: string, tenantId?: string) {
    const resolvedTenantId = tenantId ?? ((await this.prisma.tenant?.findFirst())?.id);
    const health = await this.prisma.routerHealth.findUnique({ where: { deviceId } });
    if (health && health.linkStatus !== 'up') {
      return this.prisma.actionQueue.create({
        data: { type: 'suspend', deviceId, targetId: secretId, payload: { disabled: 'yes' }, status: 'pending' },
      });
    }
    return this.routeros.updatePppSecret(deviceId, secretId, { disabled: 'yes' });
  }

  async planChange(deviceId: string, secretId: string, profile: string, tenantId?: string) {
    const resolvedTenantId = tenantId ?? ((await this.prisma.tenant?.findFirst())?.id);
    const health = await this.prisma.routerHealth.findUnique({ where: { deviceId } });
    if (health && health.linkStatus !== 'up') {
      return this.prisma.actionQueue.create({
        data: { type: 'plan-change', deviceId, targetId: secretId, payload: { profile }, status: 'pending' },
      });
    }
    return this.routeros.updatePppSecret(deviceId, secretId, { profile });
  }
}
