import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CrmService } from './crm.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-logs/audit.service';

describe('CrmService', () => {
  let service: CrmService;
  const prisma = {
    contract: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CrmService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(CrmService);
  });

  it('findAll lists contracts with subscriber context', async () => {
    prisma.contract.findMany.mockResolvedValue([{ id: 'c1' }]);
    expect(await service.findAll()).toEqual([{ id: 'c1' }]);
  });

  it('findOne returns a contract', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'c1' });
    expect(await service.findOne('c1')).toEqual({ id: 'c1' });
  });

  it('findOne throws when missing', async () => {
    prisma.contract.findUnique.mockResolvedValue(null);
    await expect(service.findOne('c1')).rejects.toThrow(NotFoundException);
  });

  it('create creates and audits', async () => {
    prisma.contract.create.mockResolvedValue({ id: 'c1' });
    const result = await service.create({ subscriberId: 's1', documentUrl: 'http://x/y.pdf' });
    expect(result).toEqual({ id: 'c1' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CONTRACT_CREATED' }));
  });

  it('update sets only provided fields and audits', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.contract.update.mockResolvedValue({ id: 'c1' });
    await service.update('c1', { signedAt: '2026-08-13T10:00:00Z' });
    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { signedAt: new Date('2026-08-13T10:00:00Z') },
      include: expect.anything(),
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CONTRACT_UPDATED' }));
  });

  it('update throws when contract missing', async () => {
    prisma.contract.findUnique.mockResolvedValue(null);
    await expect(service.update('c1', {})).rejects.toThrow(NotFoundException);
  });
});