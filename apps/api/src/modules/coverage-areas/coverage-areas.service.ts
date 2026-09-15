import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { softDelete } from '@isp/prisma';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-logs/audit.service';
import { CreateCoverageAreaDto, UpdateCoverageAreaDto } from './dto/coverage-area.dto';

@Injectable()
export class CoverageAreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService) {}

  async list(pagination?: { skip?: number; take?: number }) {
    const take = Math.min(Math.max(pagination?.take ?? 50, 1), 100);
    const skip = Math.max(pagination?.skip ?? 0, 0);
    return this.prisma.coverageArea.findMany({
      orderBy: [{ zone: 'asc' }, { name: 'asc' }],
      skip,
      take,
    });
  }

  private async assertZoneExists(zone?: string | null): Promise<void> {
    if (!zone) return;
    const slug = String(zone).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!slug) return;
    // Use raw query so soft-deleted zones are not considered valid
    const rows: Array<{ id: string }> = await this.prisma.$queryRaw`SELECT id FROM "CoverageZone" WHERE slug = ${slug} AND "deletedAt" IS NULL LIMIT 1`;
    // Also allow tenant-scoped check if tenant exists
    if (rows.length === 0) {
      // Fallback: check without tenant filter for legacy null-tenant zones
      const anyRows: Array<{ id: string }> = await this.prisma.$queryRaw`SELECT id FROM "CoverageZone" WHERE slug = ${slug} AND "deletedAt" IS NULL LIMIT 1`;
      if (anyRows.length === 0) throw new BadRequestException(`Zone "${zone}" does not exist — create it in Manage Zones first`);
    }
  }

  async create(dto: CreateCoverageAreaDto) {
    await this.assertZoneExists((dto as any).zone);
    const tenant = await this.prisma.tenant?.findFirst({ select: { id: true } });
    const data: any = { ...dto };
    if (tenant) data.tenantId = tenant.id;
    // Normalize zone to slug form
    if (data.zone) data.zone = String(data.zone).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const area = await this.prisma.coverageArea.create({
      data,
    });
    await this.audit.log({
      action: 'COVERAGE_AREA_CREATED',
      entityType: 'CoverageArea',
      entityId: area.id,
      metadata: { name: area.name, zone: area.zone },
    });
    return area;
  }

  async update(id: string, dto: UpdateCoverageAreaDto) {
    const existing = await this.prisma.coverageArea.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Coverage area ${id} not found`);
    if ((dto as any).zone) await this.assertZoneExists((dto as any).zone);
    const data: any = { ...dto };
    if (data.zone) data.zone = String(data.zone).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const area = await this.prisma.coverageArea.update({ where: { id }, data });
    await this.audit.log({
      action: 'COVERAGE_AREA_UPDATED',
      entityType: 'CoverageArea',
      entityId: id,
      metadata: { name: area.name, zone: area.zone, status: area.status },
    });
    return area;
  }

  async remove(id: string) {
    const existing = await this.prisma.coverageArea.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Coverage area ${id} not found`);
    await softDelete(this.prisma.coverageArea, { where: { id } });
    await this.audit.log({
      action: 'COVERAGE_AREA_DELETED',
      entityType: 'CoverageArea',
      entityId: id,
      metadata: { name: existing.name, zone: existing.zone },
    });
    return { id, deleted: true };
  }
}
