import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-logs/audit.service';

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll() {
    return this.prisma.contract.findMany({
      include: {
        subscriber: {
          select: { id: true, type: true, user: { select: { id: true, email: true, phone: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        subscriber: {
          select: { id: true, type: true, user: { select: { id: true, email: true, phone: true } } },
        },
      },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    return contract;
  }

  async create(data: { subscriberId: string; documentUrl: string }) {
    const contract = await this.prisma.contract.create({
      data: { subscriberId: data.subscriberId, documentUrl: data.documentUrl },
      include: {
        subscriber: {
          select: { id: true, type: true, user: { select: { id: true, email: true, phone: true } } },
        },
      },
    });
    await this.audit.log({ action: 'CONTRACT_CREATED', entityType: 'Contract', entityId: contract.id, metadata: { subscriberId: data.subscriberId } });
    return contract;
  }

  async update(id: string, data: { documentUrl?: string; signedAt?: string }) {
    const existing = await this.prisma.contract.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Contract not found');
    const updateData: any = {};
    if (data.documentUrl) updateData.documentUrl = data.documentUrl;
    if (data.signedAt) updateData.signedAt = new Date(data.signedAt);
    const contract = await this.prisma.contract.update({
      where: { id },
      data: updateData,
      include: {
        subscriber: {
          select: { id: true, type: true, user: { select: { id: true, email: true, phone: true } } },
        },
      },
    });
    await this.audit.log({ action: 'CONTRACT_UPDATED', entityType: 'Contract', entityId: id, metadata: data as any });
    return contract;
  }
}
