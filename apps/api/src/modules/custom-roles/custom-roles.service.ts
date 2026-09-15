import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { softDelete } from '@isp/prisma';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-logs/audit.service';
import { CreateCustomRoleDto, UpdateCustomRoleDto } from './dto/custom-role.dto';

@Injectable()
export class CustomRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService) {}

  async findAll() {
    return this.prisma.customRole.findMany({
      include: { permissions: true, _count: { select: { users: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const role = await this.prisma.customRole.findUnique({
      where: { id },
      include: { permissions: true, _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException(`Custom role ${id} not found`);
    return role;
  }

  /**
   * `CustomRole.name` is unique across ALL rows — soft-deleted ones included,
   * since the DB index ignores `deletedAt`. A stale row releases the name so a
   * re-created role can reuse it; a live duplicate is a 409.
   */
  private async releaseStaleRoleName(name: string): Promise<void> {
    const rows: Array<{ id: string; deletedAt: Date | null }> = await this.prisma.$queryRaw`
      SELECT id, "deletedAt" FROM "CustomRole" WHERE name = ${name} LIMIT 1
    `;
    const owner = rows[0];
    if (!owner) return;
    if (!owner.deletedAt) throw new ConflictException(`A role named "${name}" already exists`);
    await this.prisma.$queryRaw`UPDATE "CustomRole" SET name = 'deleted-' || id WHERE id = ${owner.id}`;
  }

  async create(dto: CreateCustomRoleDto) {
    const tenantId = (await this.prisma.tenant?.findFirst())?.id;
    await this.releaseStaleRoleName(dto.name);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const role = await tx.customRole.create({
          data: {
            name: dto.name,
            tenantId,
            permissions: {
              create: dto.permissions.map((p) => ({
                module: p.module,
                canView: p.canView,
                canCreate: p.canCreate,
                canEdit: p.canEdit,
                canDelete: p.canDelete,
              })),
            },
          },
          include: { permissions: true },
        });
        await this.audit.log({ action: 'ROLE_CREATED', entityType: 'CustomRole', entityId: role.id, metadata: { name: dto.name, permissionsCount: dto.permissions.length } });
        return role;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(`A role named "${dto.name}" already exists`);
      throw e;
    }
  }

  async update(id: string, dto: UpdateCustomRoleDto) {
    const existing = await this.prisma.customRole.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Custom role ${id} not found`);

    let result;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        if (dto.name) {
          await tx.customRole.update({ where: { id }, data: { name: dto.name } });
        }
        if (dto.permissions) {
          await tx.permission.deleteMany({ where: { roleId: id } });
          await tx.permission.createMany({
            data: dto.permissions.map((p) => ({
              roleId: id,
              module: p.module,
              canView: p.canView,
              canCreate: p.canCreate,
              canEdit: p.canEdit,
              canDelete: p.canDelete,
            })),
          });
        }
        return tx.customRole.findUnique({
          where: { id },
          include: { permissions: true, _count: { select: { users: true } } },
        });
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(`A role named "${dto.name}" already exists`);
      throw e;
    }
    await this.audit.log({ action: 'ROLE_UPDATED', entityType: 'CustomRole', entityId: id, metadata: { name: dto.name, hasPermissions: !!dto.permissions } });
    return result;
  }

  async remove(id: string, actor?: { id: string; isSuperAdmin?: boolean; customRole?: { name: string } | null }) {
    const existing = await this.prisma.customRole.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!existing) throw new NotFoundException(`Custom role ${id} not found`);
    if (existing._count.users > 0) {
      throw new ConflictException(`This role is assigned to ${existing._count.users} user(s). Reassign them to another role before deleting it.`);
    }
    if (actor) {
      this.audit.assertNotMaker(actor, await this.audit.makerOf('CustomRole', id), 'role');
    }
    // Soft delete: the role row and its permissions survive for audit/restore.
    // The unique name is released on demand when a new role reuses it.
    await softDelete(this.prisma.customRole, { where: { id } });
    await this.audit.log({ action: 'ROLE_DELETED', entityType: 'CustomRole', entityId: id });
  }
}
