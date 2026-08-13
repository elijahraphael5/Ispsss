import { Injectable, OnModuleInit, OnModuleDestroy, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class OwnerService implements OnModuleInit, OnModuleDestroy {
  private prisma = new PrismaClient();

  async onModuleInit() {
    await this.prisma.$connect();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  async listTenants() {
    return this.prisma.tenant.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { users: true, subscribers: true } },
      },
    });
  }

  async getTenantById(id: string) {
    return this.prisma.tenant.findUniqueOrThrow({
      where: { id },
      include: {
        _count: { select: { users: true, subscribers: true } },
      },
    });
  }

  async getTenantUsers(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: { id: true, email: true, isSuperAdmin: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTenantSubscribers(tenantId: string) {
    return this.prisma.subscriber.findMany({
      where: { tenantId },
      include: { user: { select: { email: true } }, subscriptions: { select: { id: true, planId: true, expiresAt: true, suspendedAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
