import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantService } from '../../common/tenant/tenant.service';
import { AuditService } from '../audit-logs/audit.service';

const userSelect = {
  id: true, email: true, name: true, phone: true, isSuperAdmin: true, twoFaEnabled: true, createdAt: true, updatedAt: true,
  customRoleId: true,
  customRole: { select: { id: true, name: true } },
};

const planSelect = { id: true, name: true, technology: true, category: true, speedMbps: true, speedLabel: true, priceKobo: true };

const customerInclude: Prisma.SubscriberInclude = {
  user: { select: { id: true, name: true, email: true, phone: true } },
  subscriptions: {
    include: { plan: { select: planSelect } },
    orderBy: { startedAt: 'desc' },
    take: 1,
  },
  invoices: {
    where: { status: { in: ['ISSUED', 'OVERDUE'] } },
    orderBy: { dueAt: 'asc' },
    take: 1,
  },
  devices: true,
};

function toCustomerView(sub: any) {
  const plan = sub.subscriptions?.[0]?.plan ?? null;
  const due = sub.invoices?.[0] ?? null;
  const email: string | null = sub.user?.email ?? null;
  const address: string | null = sub.address ?? null;
  return {
    id: sub.id,
    userId: sub.userId,
    name: sub.user?.name ?? null,
    email: email && !email.endsWith('@lan') ? email : null,
    phone: sub.user?.phone ?? null,
    address: address && !address.startsWith('Static IP:') ? address : null,
    status: sub.status,
    type: sub.type,
    networkType: sub.networkType ?? plan?.technology ?? null,
    plan: plan?.name ?? null,
    planCategory: plan?.category ?? null,
    speedMbps: plan?.speedMbps ?? null,
    speedLabel: plan?.speedLabel ?? null,
    priceKobo: plan?.priceKobo ?? null,
    startedAt: sub.subscriptions?.[0]?.startedAt ?? null,
    expiresAt: sub.subscriptions?.[0]?.expiresAt ?? null,
    dueAt: due?.dueAt ?? null,
    dueAmountKobo: due?.amountKobo ?? null,
    dueStatus: due?.status ?? null,
    cpes: (sub.devices ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      ipAddress: c.ipAddress,
      macAddress: c.macAddress,
      status: c.status,
      connectionType: c.connectionType,
      installerName: c.installerName,
      lastSeenAt: c.lastSeenAt,
    })),
    createdAt: sub.createdAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  async findAll() {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      select: userSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id, deletedAt: null },
      select: userSelect,
    });
  }

  async create(data: { email: string; password: string; phone?: string; name?: string; customRoleId?: string }, actorId: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ConflictException('A user with this email already exists');
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(data.password, 12);
    const tenantId = await this.tenant.resolveTenant();
    const result = await this.prisma.user.create({
      data: { tenantId, email: data.email, name: data.name, passwordHash, phone: data.phone, customRoleId: data.customRoleId },
      select: userSelect,
    });
    await this.audit.log({ actorId, action: 'USER_CREATED', entityType: 'User', entityId: result.id, afterData: { email: data.email, name: data.name, phone: data.phone, customRoleId: data.customRoleId } as any, metadata: { email: data.email, customRoleId: data.customRoleId } });
    return result;
  }

  async update(id: string, data: { email?: string; name?: string; phone?: string; customRoleId?: string; password?: string; isSuperAdmin?: boolean }, actorId: string) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true, name: true, phone: true, isSuperAdmin: true, customRoleId: true } });
    const updateData: any = { ...data };
    if (data.password) {
      const bcrypt = await import('bcryptjs');
      updateData.passwordHash = await bcrypt.hash(data.password, 12);
    }
    delete updateData.password;
    const result = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: userSelect,
    });
    await this.audit.log({ actorId, action: 'USER_UPDATED', entityType: 'User', entityId: id, beforeData: before as any, afterData: { email: result.email, name: result.name, phone: result.phone, isSuperAdmin: result.isSuperAdmin, customRoleId: result.customRoleId } as any, metadata: { changes: Object.keys(data) } });
    return result;
  }

  async customers() {
    const tenantId = await this.tenant.resolveTenant();
    const subs = await this.prisma.subscriber.findMany({
      where: { tenantId, deletedAt: null },
      include: customerInclude,
      orderBy: { createdAt: 'desc' },
    });
    return subs.map(toCustomerView);
  }

  async customerDetail(id: string) {
    const sub = await this.prisma.subscriber.findUniqueOrThrow({
      where: { id, deletedAt: null },
      include: customerInclude,
    });
    return toCustomerView(sub);
  }

  async updateCustomer(id: string, data: { name?: string; email?: string; phone?: string; address?: string; installerName?: string; networkType?: string; planName?: string; dueAt?: string }, actorId: string) {
    const sub = await this.prisma.subscriber.findUniqueOrThrow({ where: { id, deletedAt: null }, include: { user: true } });
    if (data.email !== undefined || data.phone !== undefined || data.name !== undefined) {
      await this.prisma.user.update({
        where: { id: sub.userId },
        data: {
          ...(data.name !== undefined ? { name: data.name || null } : {}),
          ...(data.email !== undefined ? { email: data.email } : {}),
          ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
        },
      });
    }
    if (data.address !== undefined || data.networkType !== undefined) {
      await this.prisma.subscriber.update({
        where: { id },
        data: {
          ...(data.address !== undefined ? { address: data.address || null } : {}),
          ...(data.networkType !== undefined ? { networkType: data.networkType || null } : {}),
        },
      });
    }
    if (data.installerName !== undefined) {
      await this.prisma.cpe.updateMany({ where: { subscriberId: id }, data: { installerName: data.installerName || null } });
    }
    if (data.planName !== undefined && data.planName) {
      const plan = await this.prisma.plan.findFirst({ where: { tenantId: sub.tenantId, name: { equals: data.planName, mode: 'insensitive' } } });
      if (!plan) throw new NotFoundException(`Plan "${data.planName}" not found`);
      const latest = await this.prisma.subscription.findFirst({ where: { subscriberId: id }, orderBy: { startedAt: 'desc' } });
      if (latest) {
        await this.prisma.subscription.update({ where: { id: latest.id }, data: { planId: plan.id } });
      } else {
        await this.prisma.subscription.create({
          data: { subscriberId: id, planId: plan.id, startedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
        });
      }
    }
    if (data.dueAt !== undefined) {
      const due = new Date(data.dueAt);
      if (isNaN(due.getTime())) throw new BadRequestException('Invalid dueAt date');
      const unpaid = await this.prisma.invoice.findFirst({
        where: { subscriberId: id, status: { in: ['DRAFT', 'ISSUED', 'OVERDUE'] } },
        orderBy: { dueAt: 'asc' },
      });
      if (unpaid) {
        await this.prisma.invoice.update({ where: { id: unpaid.id }, data: { dueAt: due } });
      } else {
        const subWithPlan = await this.prisma.subscription.findFirst({ where: { subscriberId: id }, include: { plan: true }, orderBy: { startedAt: 'desc' } });
        if (subWithPlan) {
          const subtotal = subWithPlan.plan.priceKobo;
          const vat = Math.round(subtotal * 0.075);
          await this.prisma.invoice.create({
            data: {
              subscriberId: id,
              invoiceNumber: `INV-${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`,
              type: 'SUBSCRIPTION',
              status: 'ISSUED',
              subtotalKobo: subtotal,
              vatKobo: vat,
              amountKobo: subtotal + vat,
              dueAt: due,
              issuedAt: new Date(),
            },
          });
        }
      }
    }
    await this.audit.log({ actorId, action: 'USER_UPDATED', entityType: 'User', entityId: sub.userId, beforeData: { name: sub.user.name, email: sub.user.email, phone: sub.user.phone } as any, afterData: data as any, metadata: { changes: Object.keys(data) } });
    return this.customerDetail(id);
  }

  async remove(id: string, actorId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true, phone: true, customRoleId: true, isSuperAdmin: true } });
    await this.audit.log({ actorId, action: 'USER_DELETED', entityType: 'User', entityId: id, beforeData: user as any, metadata: { email: user.email } });
    return this.prisma.$transaction(async (tx) => {
      await tx.auditLog.deleteMany({ where: { actorId: id } });
      await tx.refreshToken.deleteMany({ where: { userId: id } });
      return tx.user.delete({ where: { id }, select: userSelect });
    });
  }
}
