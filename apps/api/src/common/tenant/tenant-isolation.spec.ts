import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from './tenant-context';
import { PrismaModule } from '../prisma/prisma.module';

describe('Tenant Isolation', () => {
  let prisma: PrismaService;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();
    prisma = module.get(PrismaService);

    const ts = Date.now();
    tenantA = `test-tenant-a-${ts}`;
    tenantB = `test-tenant-b-${ts}`;

    await prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'Tenant A', slug: tenantA },
        { id: tenantB, name: 'Tenant B', slug: tenantB },
      ],
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await prisma.$disconnect();
  });

  describe('User (tenant-aware model)', () => {
    it('create sets tenantId from context', async () => {
      const email = `a-${Date.now()}@test.com`;
      const result = await TenantContext.run(tenantA, () =>
        prisma.user.create({
          data: { email, passwordHash: 'hash' } as any,
        }),
      );
      expect(result.tenantId).toBe(tenantA);
    });

    it('findMany only returns records for current tenant', async () => {
      const email = `cross-${Date.now()}@test.com`;

      await TenantContext.run(tenantA, () =>
        prisma.user.create({ data: { email, passwordHash: 'hash' } as any }),
      );

      const usersB = await TenantContext.run(tenantB, () =>
        prisma.user.findMany({ where: { email } }),
      );
      expect(usersB).toHaveLength(0);
    });

    it('findFirst scopes to tenant', async () => {
      const email = `ff-${Date.now()}@test.com`;

      const userA = await TenantContext.run(tenantA, () =>
        prisma.user.create({ data: { email, passwordHash: 'hash' } as any }),
      );

      const foundA = await TenantContext.run(tenantA, () =>
        prisma.user.findFirst({ where: { email } }),
      );
      expect(foundA).not.toBeNull();
      expect(foundA!.id).toBe(userA.id);

      const foundB = await TenantContext.run(tenantB, () =>
        prisma.user.findFirst({ where: { email } }),
      );
      expect(foundB).toBeNull();
    });

    it('count scopes to tenant', async () => {
      const email = `cnt-${Date.now()}@test.com`;

      await TenantContext.run(tenantA, () =>
        prisma.user.create({ data: { email, passwordHash: 'hash' } as any }),
      );

      const countB = await TenantContext.run(tenantB, () =>
        prisma.user.count({ where: { email } }),
      );
      expect(countB).toBe(0);
    });
  });
});
