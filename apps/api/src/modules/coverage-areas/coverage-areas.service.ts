import { Injectable, NotFoundException } from '@nestjs/common';
import { softDelete } from '@isp/prisma';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantService } from '../../common/tenant/tenant.service';
import { AuditService } from '../audit-logs/audit.service';
import { CreateCoverageAreaDto, UpdateCoverageAreaDto } from './dto/coverage-area.dto';

@Injectable()
export class CoverageAreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const tenantId = await this.tenant.resolveTenant();
    return this.prisma.coverageArea.findMany({
      where: { tenantId },
      orderBy: [{ zone: 'asc' }, { name: 'asc' }],
    });
  }

  async create(dto: CreateCoverageAreaDto) {
    const tenantId = await this.tenant.resolveTenant();
    const area = await this.prisma.coverageArea.create({
      data: { ...dto, tenantId },
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
    const area = await this.prisma.coverageArea.update({ where: { id }, data: dto });
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
