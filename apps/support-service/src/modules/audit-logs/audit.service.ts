import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditContext } from './audit-context';

const MODEL_MAP: Record<string, string> = {
  User: 'user', Invoice: 'invoice', Subscriber: 'subscriber', Plan: 'plan',
  Ticket: 'ticket', CustomRole: 'customRole', Cpe: 'cpe', NetworkDevice: 'networkDevice',
  Subscription: 'subscription', Payment: 'payment', Contract: 'contract', Notification: 'notification',
  ChatSession: 'chatSession', TicketComment: 'ticketComment', CannedResponse: 'cannedResponse',
  FileUpload: 'fileUpload',
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    actorId?: string;
    action: string;
    entityType: string;
    entityId: string;
    beforeData?: Record<string, unknown> | null;
    afterData?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  }) {
    const actorId = params.actorId ?? AuditContext.getActorId() ?? 'SYSTEM';
    return this.prisma.auditLog.create({ data: { actorId, action: params.action, entityType: params.entityType, entityId: params.entityId, beforeData: (params.beforeData ?? null) as any, afterData: (params.afterData ?? null) as any, metadata: params.metadata as any } });
  }

  async findAll(params: {
    entityType?: string;
    action?: string;
    actorId?: string;
    page?: number;
    limit?: number;
  }) {
    const where: any = {};
    if (params.entityType) where.entityType = params.entityType;
    if (params.action) where.action = params.action;
    if (params.actorId) where.actorId = params.actorId;

    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    return this.prisma.auditLog.findUniqueOrThrow({
      where: { id },
      include: { actor: { select: { id: true, email: true } } },
    });
  }

  async rollback(id: string) {
    const entry = await this.prisma.auditLog.findUniqueOrThrow({ where: { id } });
    const model = MODEL_MAP[entry.entityType];
    if (!model) throw new BadRequestException(`Rollback not supported for entity type: ${entry.entityType}`);

    const prismaModel = (this.prisma as any)[model];
    if (!prismaModel) throw new BadRequestException(`Prisma model not found: ${model}`);

    return this.prisma.$transaction(async (tx) => {
      const txModel = (tx as any)[model];

      if (entry.action.endsWith('_CREATED')) {
        await txModel.delete({ where: { id: entry.entityId } });
        return { rolledBack: true, action: 'DELETE', entityType: entry.entityType, entityId: entry.entityId };
      }

      if (entry.action.endsWith('_UPDATED') && entry.beforeData) {
        const { id: _ignore, createdAt, updatedAt, deletedAt, ...rest } = entry.beforeData as any;
        await txModel.update({ where: { id: entry.entityId }, data: { ...rest } });
        return { rolledBack: true, action: 'RESTORE', entityType: entry.entityType, entityId: entry.entityId };
      }

      if (entry.action.endsWith('_DELETED') && entry.afterData) {
        const { id: _ignore, ...rest } = entry.afterData as any;
        await txModel.create({ data: rest });
        return { rolledBack: true, action: 'RESTORE', entityType: entry.entityType, entityId: entry.entityId };
      }

      throw new BadRequestException('Cannot rollback — insufficient data');
    });
  }
}
