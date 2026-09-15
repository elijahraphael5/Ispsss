import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { softDelete } from '@isp/prisma';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-logs/audit.service';
import { CreateCoverageZoneDto, UpdateCoverageZoneDto } from './dto/coverage-zone.dto';

function toSlug(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

@Injectable()
export class CoverageZonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.coverageZone.findMany({ orderBy: [{ label: 'asc' }] } as any);
  }

  private async releaseStaleSlug(tenantId: string, slug: string): Promise<void> {
    const rows: Array<{ id: string; deletedAt: Date | null }> = await this.prisma.$queryRaw`
      SELECT id, "deletedAt" FROM "CoverageZone" WHERE "tenantId" = ${tenantId} AND slug = ${slug} LIMIT 1
    `;
    const owner = rows[0];
    if (!owner) return;
    if (!owner.deletedAt) throw new ConflictException(`Zone "${slug}" already exists`);
    await this.prisma.$queryRaw`UPDATE "CoverageZone" SET slug = 'deleted-' || id WHERE id = ${owner.id}`;
  }

  async create(dto: CreateCoverageZoneDto) {
    const tenant = await this.prisma.tenant?.findFirst({ select: { id: true } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const slug = dto.slug ? toSlug(dto.slug) : toSlug(dto.name);
    if (!slug) throw new BadRequestException('Zone slug cannot be empty');
    const name = dto.name.trim();
    // check duplicate slug — include soft-deleted rows via raw so stale is freed, live is 409
    await this.releaseStaleSlug(tenant.id, slug);
    const zone = await this.prisma.coverageZone.create({ data: { tenantId: tenant.id, slug, label: name } as any });
    await this.audit.log({
      action: 'COVERAGE_ZONE_CREATED',
      entityType: 'CoverageZone',
      entityId: zone.id,
      metadata: { slug, label: name } as any,
    });
    return zone;
  }

  async update(id: string, dto: UpdateCoverageZoneDto) {
    const existing = await this.prisma.coverageZone.findUnique({ where: { id } } as any);
    if (!existing) throw new NotFoundException(`Coverage zone ${id} not found`);
    const data: any = {};
    let newSlug = existing.slug;
    if (dto.name !== undefined) {
      data.label = dto.name.trim();
    }
    if (dto.slug !== undefined) {
      newSlug = toSlug(dto.slug);
      data.slug = newSlug;
    } else if (dto.name !== undefined) {
      // auto-rename slug when label changes, keep uniqueness
      newSlug = toSlug(dto.name);
      data.slug = newSlug;
    }
    // if slug changed, ensure unique — include soft-deleted via raw so stale is freed, live is 409
    if (newSlug !== existing.slug) {
      const tenantId = (existing as any).tenantId as string;
      const dupRows: Array<{ id: string; deletedAt: Date | null }> = await this.prisma.$queryRaw`
        SELECT id, "deletedAt" FROM "CoverageZone" WHERE "tenantId" = ${tenantId} AND slug = ${newSlug} AND id <> ${id} LIMIT 1
      `;
      const dup = dupRows[0];
      if (dup) {
        if (!dup.deletedAt) throw new ConflictException(`Zone "${newSlug}" already exists`);
        await this.prisma.$queryRaw`UPDATE "CoverageZone" SET slug = 'deleted-' || id WHERE id = ${dup.id}`;
      }
      // cascade rename coverage areas that used old slug — include tenant-scoped and legacy null-tenant rows, only live areas
      await this.prisma.$queryRaw`UPDATE "CoverageArea" SET zone = ${newSlug} WHERE zone = ${existing.slug} AND ("tenantId" = ${tenantId} OR "tenantId" IS NULL) AND "deletedAt" IS NULL`;
    }
    const zone = await this.prisma.coverageZone.update({ where: { id }, data } as any);
    await this.audit.log({
      action: 'COVERAGE_ZONE_UPDATED',
      entityType: 'CoverageZone',
      entityId: id,
      metadata: { slug: newSlug, label: data.label } as any,
    });
    return zone;
  }

  async remove(id: string) {
    const existing = await this.prisma.coverageZone.findUnique({ where: { id } } as any);
    if (!existing) throw new NotFoundException(`Coverage zone ${id} not found`);
    // prevent delete if areas still reference it — check tenant-scoped and legacy null-tenant rows, only live (not soft-deleted) areas block
    const tenantId = (existing as any).tenantId;
    const inUseRows: Array<{ id: string }> = await this.prisma.$queryRaw`SELECT id FROM "CoverageArea" WHERE zone = ${existing.slug} AND ("tenantId" = ${tenantId} OR "tenantId" IS NULL) AND "deletedAt" IS NULL LIMIT 1`;
    if (inUseRows.length) throw new BadRequestException(`Cannot delete zone "${existing.slug}" — areas still use it. Move or delete those areas first.`);
    await softDelete(this.prisma.coverageZone, { where: { id } });
    await this.audit.log({
      action: 'COVERAGE_ZONE_DELETED',
      entityType: 'CoverageZone',
      entityId: id,
      metadata: { slug: existing.slug, label: (existing as any).label } as any,
    });
    return { id, deleted: true };
  }
}
