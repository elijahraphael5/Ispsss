import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveTenant(slug?: string): Promise<string>;
  async resolveTenant(userId?: string): Promise<string>;
  async resolveTenant(slugOrUserId?: string): Promise<string> {
    if (!slugOrUserId) {
      const tenants = await this.prisma.tenant.findMany({ take: 1 });
      return tenants[0]?.id;
    }

    const bySlug = await this.prisma.tenant.findUnique({ where: { slug: slugOrUserId } });
    if (bySlug) return bySlug.id;

    const user = await this.prisma.user.findUnique({ where: { id: slugOrUserId } });
    if (user) return user.tenantId;

    return slugOrUserId;
  }
}
