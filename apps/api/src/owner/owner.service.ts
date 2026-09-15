import { Injectable, OnModuleInit, OnModuleDestroy, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { applyPrismaExtensions } from '@isp/prisma';

@Injectable()
export class OwnerService implements OnModuleInit, OnModuleDestroy {
  private prisma = applyPrismaExtensions(new PrismaClient(
    (() => {
      const url = process.env.DATABASE_URL;
      if (!url) return undefined;
      const hasLimit = url.includes('connection_limit=');
      const sep = url.includes('?') ? '&' : '?';
      const finalUrl = hasLimit ? url : `${url}${sep}connection_limit=5`;
      return { datasources: { db: { url: finalUrl } } } as any;
    })(),
  ) as any);

  async onModuleInit() {
    await this.prisma.$connect();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  async listTenants() {
    return this.prisma.tenant?.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { users: true, subscribers: true } },
      },
    });
  }

  async getTenantById(id: string) {
    return this.prisma.tenant?.findUniqueOrThrow({
      where: { id },
      include: {
        _count: { select: { users: true, subscribers: true } },
      },
    });
  }

  async getTenantUsers(tenantId: string) {
    return this.prisma.user.findMany({
      where: {},
      select: { id: true, email: true, isSuperAdmin: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTenantSubscribers(tenantId: string) {
    return this.prisma.subscriber.findMany({
      where: {},
      include: { user: { select: { email: true } }, subscriptions: { select: { id: true, planId: true, expiresAt: true, suspendedAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
