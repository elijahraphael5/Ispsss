import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupportService } from './support.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantService } from '../../common/tenant/tenant.service';
import { AuditService } from '../audit-logs/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

const agent = { id: 'agent1', email: 'agent1@isp.local', isSuperAdmin: false, customRole: { name: 'SUPPORT_AGENT' } };
const customer = { id: 'cust1', email: 'cust@x.co', isSuperAdmin: false };

describe('SupportService', () => {
  let service: SupportService;
  const prisma = {
    subscriber: { findFirst: jest.fn() },
    chatSession: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    chatMessage: { create: jest.fn(), count: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
    ticket: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    ticketComment: { create: jest.fn(), findUnique: jest.fn() },
    cannedResponse: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    agentPresence: { upsert: jest.fn() },
    user: { findMany: jest.fn() },
    fileUpload: { findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  };
  const tenant = { resolveTenant: jest.fn().mockResolvedValue('tenant-1') };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SupportService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantService, useValue: tenant },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(SupportService);
  });

  describe('createSession', () => {
    it('reuses an open WAITING/ACTIVE session instead of creating a duplicate', async () => {
      prisma.subscriber.findFirst.mockResolvedValue({ id: 's1' });
      const open = { id: 'chat1', status: 'ACTIVE', messages: [] };
      prisma.chatSession.findFirst.mockResolvedValue(open);
      const result = await service.createSession({ userId: 'cust1', email: 'cust@x.co' });
      expect(result).toEqual(open);
      expect(prisma.chatSession.create).not.toHaveBeenCalled();
    });

    it('creates a WAITING session when none is open and audits it', async () => {
      prisma.subscriber.findFirst.mockResolvedValue(null);
      prisma.chatSession.findFirst.mockResolvedValue(null);
      prisma.chatSession.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'chat1', messages: [] }));
      const session = await service.createSession({ userId: 'cust1', email: 'cust@x.co', department: 'BILLING' });
      expect(prisma.chatSession.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant-1', subscriberId: null, customerName: 'cust', customerEmail: 'cust@x.co', department: 'BILLING', status: 'WAITING' },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CHAT_SESSION_CREATED' }));
      expect(session.status).toBe('WAITING');
    });
  });

  describe('getSession access control', () => {
    it('forbids a customer who does not own the session', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', subscriberId: 'other-sub', messages: [], agent: null, tickets: [], subscriber: null });
      await expect(service.getSession('chat1', customer)).rejects.toThrow(ForbiddenException);
    });

    it('allows an agent to view any session', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', subscriberId: 's1', messages: [], agent: null, tickets: [], subscriber: null });
      await expect(service.getSession('chat1', agent)).resolves.toBeTruthy();
    });
  });

  describe('sendMessage', () => {
    it('rejects messages on a closed session', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', status: 'CLOSED' });
      await expect(
        service.sendMessage({ sessionId: 'chat1', senderType: 'CUSTOMER', body: 'hi', actor: customer }),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets ACTIVE + firstResponseAt + agentId on the first agent reply', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', status: 'WAITING', subscriberId: 's1', firstResponseAt: null, agentId: null });
      prisma.subscriber.findFirst.mockResolvedValue({ id: 's1' });
      prisma.chatMessage.create.mockResolvedValue({ id: 'm1', sessionId: 'chat1', senderId: 'agent1', senderName: 'agent1', senderType: 'AGENT', body: 'hello', status: 'SENT' });
      prisma.chatMessage.findUnique.mockResolvedValue({ id: 'm1', attachments: [] });
      prisma.chatSession.update.mockResolvedValue({ id: 'chat1', status: 'ACTIVE', firstResponseAt: new Date(), agentId: 'agent1' });
      await service.sendMessage({ sessionId: 'chat1', senderType: 'AGENT', body: 'hello', actor: agent });
      expect(prisma.chatSession.update).toHaveBeenCalledWith({
        where: { id: 'chat1' },
        data: expect.objectContaining({ status: 'ACTIVE', firstResponseAt: expect.any(Date), agentId: 'agent1' }),
      });
    });

    it('denies a customer who is not the session owner', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', status: 'ACTIVE', subscriberId: 'other-sub' });
      prisma.subscriber.findFirst.mockResolvedValue(null);
      await expect(
        service.sendMessage({ sessionId: 'chat1', senderType: 'CUSTOMER', body: 'hi', actor: customer }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('pickUp & reassign', () => {
    it('assigns the acting agent and audits with before/after snapshots', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', status: 'WAITING', agentId: null });
      prisma.chatSession.update.mockResolvedValue({ id: 'chat1', status: 'ACTIVE', agentId: 'agent1' });
      await service.pickUp('chat1', agent);
      expect(prisma.chatSession.update).toHaveBeenCalledWith({ where: { id: 'chat1' }, data: { agentId: 'agent1', status: 'ACTIVE' } });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'CHAT_SESSION_ASSIGNED',
        beforeData: { status: 'WAITING', agentId: null },
        afterData: expect.objectContaining({ agentId: 'agent1', status: 'ACTIVE' }),
      }));
    });

    it('blocks picking up a closed session', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', status: 'CLOSED' });
      await expect(service.pickUp('chat1', agent)).rejects.toThrow(BadRequestException);
    });

    it('only the assigned agent (or super admin) can reassign', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', status: 'ACTIVE', agentId: 'someone-else' });
      prisma.chatSession.update.mockResolvedValue({});
      await expect(service.reassign('chat1', 'agent2', agent)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('close & read & rate', () => {
    it('is idempotent when closing an already closed session', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', status: 'CLOSED', subscriberId: null });
      const result = await service.closeSession('chat1', agent);
      expect(result.status).toBe('CLOSED');
      expect(prisma.chatSession.update).not.toHaveBeenCalled();
    });

    it('lets the owner close and audits the state change', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', status: 'ACTIVE', subscriberId: 's1' });
      prisma.subscriber.findFirst.mockResolvedValue({ id: 's1' });
      prisma.chatSession.update.mockResolvedValue({ id: 'chat1', status: 'CLOSED', closedAt: new Date() });
      await service.closeSession('chat1', customer);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CHAT_SESSION_CLOSED' }));
    });

    it('agent reads mark CUSTOMER messages read; customer marks AGENT messages read', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', status: 'ACTIVE' });
      prisma.chatMessage.updateMany.mockResolvedValue({ count: 3 });
      let r = await service.markSessionRead('chat1', agent);
      expect(r.senderType).toBe('CUSTOMER');
      r = await service.markSessionRead('chat1', customer);
      expect(r.senderType).toBe('AGENT');
      const calls = prisma.chatMessage.updateMany.mock.calls.map((c: any) => c[0].where.senderType);
      expect(calls).toEqual(['CUSTOMER', 'AGENT']);
    });

    it('only the owner can rate and only once', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', status: 'CLOSED', subscriberId: 's1', csat: null });
      prisma.subscriber.findFirst.mockImplementation(({ where }: any) => Promise.resolve(where.userId === 'cust1' ? { id: 's1' } : null));
      prisma.chatSession.update.mockResolvedValue({ id: 'chat1', csat: 4 });
      await expect(service.rateSession('chat1', agent, 5)).rejects.toThrow(ForbiddenException);
      await service.rateSession('chat1', customer, 5);
      expect(prisma.chatSession.update).toHaveBeenCalledWith({ where: { id: 'chat1' }, data: { csat: 5 } });
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', status: 'CLOSED', subscriberId: 's1', csat: 5 });
      await expect(service.rateSession('chat1', customer, 1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('convertSessionToTicket', () => {
    it('returns the existing ticket when already converted (idempotent)', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', subscriber: { id: 's1' } });
      prisma.ticket.findUnique.mockResolvedValue({ id: 't1' });
      const t = await service.convertSessionToTicket('chat1', agent, {});
      expect(t).toEqual({ id: 't1' });
      expect(prisma.ticket.create).not.toHaveBeenCalled();
    });

    it('creates a MEDIUM-priority ticket with 24h SLA from a chat session', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', tenantId: 'tenant-1', subscriber: { id: 's1' }, customerName: 'cust', customerEmail: 'cust@x.co', department: 'LIVE_CHAT' });
      prisma.ticket.findUnique.mockResolvedValue(null);
      prisma.ticket.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 't1' }));
      const before = Date.now();
      const t = await service.convertSessionToTicket('chat1', agent, { subject: 'Issue' });
      expect(t.priority).toBe('MEDIUM');
      expect(t.category).toBe('LIVE_CHAT');
      expect(t.slaDueAt!.getTime()).toBeGreaterThan(before + 23 * 60 * 60 * 1000);
      expect(t.slaDueAt!.getTime()).toBeLessThanOrEqual(before + 24 * 60 * 60 * 1000 + 1000);
    });

    it('refuses to convert a session with no linked subscriber', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', subscriber: null });
      prisma.ticket.findUnique.mockResolvedValue(null);
      await expect(service.convertSessionToTicket('chat1', agent, {})).rejects.toThrow(BadRequestException);
    });
  });

  describe('tickets', () => {
    it('applies SLA hours per priority and notifies for HIGH/URGENT only', async () => {
      prisma.ticket.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 't1' }));
      await service.createTicket({ subscriberId: 's1', subject: 'Down', priority: 'URGENT' });
      expect(prisma.ticket.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ priority: 'URGENT', slaDueAt: expect.any(Date) }),
      }));
      const urgentData = prisma.ticket.create.mock.calls[0][0].data;
      expect(urgentData.slaDueAt.getTime() - Date.now()).toBeLessThanOrEqual(2 * 60 * 60 * 1000 + 1000);
      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'URGENT: Down', type: 'ERROR' }));

      jest.clearAllMocks();
      prisma.ticket.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 't2' }));
      await service.createTicket({ subscriberId: 's1', subject: 'Billing question', priority: 'LOW' });
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('sets resolvedAt when a ticket is resolved and audits before/after', async () => {
      prisma.ticket.findUniqueOrThrow.mockResolvedValue({ id: 't1', subject: 'S', status: 'OPEN', priority: 'MEDIUM', assignedAgentId: null });
      prisma.ticket.update.mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, subject: 'S', status: data.status, priority: data.priority, assignedAgentId: data.assignedAgentId, resolvedAt: data.resolvedAt }));
      await service.updateTicket('t1', { status: 'RESOLVED' }, agent);
      expect(prisma.ticket.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: expect.objectContaining({ status: 'RESOLVED', resolvedAt: expect.any(Date) }) });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'TICKET_UPDATED', beforeData: expect.any(Object), afterData: expect.any(Object) }));
    });

    it('blocks customer internal notes but allows agent internal notes', async () => {
      prisma.ticket.findUniqueOrThrow.mockResolvedValue({ id: 't1' });
      await expect(
        service.addTicketComment('t1', { body: 'visible?', internal: true }, customer, 'CUSTOMER'),
      ).rejects.toThrow(ForbiddenException);
      prisma.ticketComment.create.mockResolvedValue({ id: 'c1' });
      prisma.ticketComment.findUnique.mockResolvedValue({ id: 'c1', attachments: [] });
      await service.addTicketComment('t1', { body: 'note', internal: true }, agent, 'AGENT');
      expect(prisma.ticketComment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ authorId: 'agent1', authorType: 'AGENT', internal: true }),
      });
    });

    it('links uploaded attachments to the comment', async () => {
      prisma.ticket.findUniqueOrThrow.mockResolvedValue({ id: 't1' });
      prisma.ticketComment.create.mockResolvedValue({ id: 'c1' });
      prisma.ticketComment.findUnique.mockResolvedValue({ id: 'c1', attachments: [] });
      prisma.fileUpload.updateMany.mockResolvedValue({ count: 1 });
      await service.addTicketComment('t1', { body: 'with file', attachmentIds: ['f1'] }, agent, 'AGENT');
      expect(prisma.fileUpload.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['f1'] }, ticketId: 't1', ticketCommentId: null, uploadedById: 'agent1' },
        data: { ticketCommentId: 'c1' },
      });
    });
  });

  describe('agents & presence & canned', () => {
    it('lists users with agent roles and their presence state', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'a1', email: 'one@x.co', customRole: { name: 'SUPPORT_AGENT' }, agentPresence: { status: 'AWAY', lastSeenAt: new Date() } },
        { id: 'a2', email: 'two@x.co', customRole: { name: 'SUPPORT_AGENT' }, agentPresence: null },
      ]);
      const agents = await service.listAgents();
      expect(agents).toHaveLength(2);
      expect(agents[0].presence).toBe('AWAY');
      expect(agents[1].presence).toBe('OFFLINE');
    });

    it('upserts presence with tenant', async () => {
      prisma.agentPresence.upsert.mockResolvedValue({});
      await service.setPresence('a1', 'ONLINE');
      expect(prisma.agentPresence.upsert).toHaveBeenCalledWith({
        where: { userId: 'a1' },
        create: expect.objectContaining({ tenantId: 'tenant-1', userId: 'a1', status: 'ONLINE' }),
        update: expect.objectContaining({ status: 'ONLINE' }),
      });
    });

    it('increments usage count when a canned reply is used', async () => {
      prisma.cannedResponse.update.mockResolvedValue({});
      await service.useCanned('cr1');
      expect(prisma.cannedResponse.update).toHaveBeenCalledWith({ where: { id: 'cr1' }, data: { usageCount: { increment: 1 } } });
    });
  });

  describe('attachments', () => {
    it('customer can upload to their own session only', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', status: 'ACTIVE', subscriberId: 's1' });
      prisma.subscriber.findFirst.mockResolvedValue(null); // not the owner
      await expect(service.saveChatAttachment('chat1', customer, { originalname: 'a.png', mimetype: 'image/png', size: 10, buffer: Buffer.from('x') }))
        .rejects.toThrow(ForbiddenException);
    });

    it('agent can upload to any open session', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'chat1', status: 'ACTIVE', subscriberId: null });
      prisma.fileUpload.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'f1' }));
      const up = await service.saveChatAttachment('chat1', agent, { originalname: 'a.png', mimetype: 'image/png', size: 10, buffer: Buffer.from('x') });
      expect(up.fileName).toBe('a.png');
      expect(up.url).toContain('/api/v1/chat/attachments/');
    });

    it('denies attachment fetch for a mismatched tenant', async () => {
      prisma.fileUpload.findUnique.mockResolvedValue({ id: 'f1', tenantId: 'other-tenant', storedPath: 'chat/x/a.png', fileName: 'a.png', mimeType: 'image/png', sizeBytes: 1, session: null, ticket: null, ticketComment: null });
      await expect(service.getAttachmentFile('f1', agent)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createTicketForCustomer', () => {
    it('creates a ticket with a customer comment and notifies on HIGH priority', async () => {
      prisma.subscriber.findFirst.mockResolvedValue({ id: 's1', user: { email: 'cust@x.co' } });
      prisma.ticket.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 't1' }));
      prisma.ticketComment.create.mockResolvedValue({});
      const t = await service.createTicketForCustomer('cust1', { subject: 'Slow internet', priority: 'HIGH', description: 'from 8pm' });
      expect(prisma.ticket.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subscriberId: 's1', priority: 'HIGH' }) }));
      expect(prisma.ticketComment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ authorId: 'cust1', authorType: 'CUSTOMER', body: 'from 8pm', internal: false }),
      });
      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'HIGH: Slow internet' }));
      expect(t.id).toBe('t1');
    });
  });

  describe('performance', () => {
    it('computes per-agent metrics and totals for the requested range', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'a1', email: 'one@x.co', customRole: { name: 'SUPPORT_AGENT' }, agentPresence: { status: 'ONLINE', lastSeenAt: new Date() } }]);
      const now = Date.now();
      prisma.chatSession.findMany.mockResolvedValue([
        { id: 'c1', status: 'CLOSED', createdAt: new Date(now - 600000), firstResponseAt: new Date(now - 580000), closedAt: new Date(now - 300000), csat: 5 },
        { id: 'c2', status: 'ACTIVE', createdAt: new Date(now - 100000), firstResponseAt: null, closedAt: null, csat: null },
      ]);
      prisma.ticket.count.mockResolvedValue(2);
      const report = await service.performance('today');
      expect(report.agents).toHaveLength(1);
      const row = report.agents[0];
      expect(row.chatsHandled).toBe(2);
      expect(row.closedChats).toBe(1);
      expect(row.avgFirstResponseSec).toBe(20);
      expect(row.avgCsat).toBe(5);
      expect(row.ticketsResolved).toBe(2);
      expect(report.totals.chatsHandled).toBe(2);
    });

    it('returns empty totals when no agents exist', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      const report = await service.performance('week');
      expect(report.agents).toEqual([]);
      expect(report.totals).toEqual({ chatsHandled: 0, closedChats: 0, ticketsResolved: 0, avgCsat: 0 });
    });
  });

  describe('history', () => {
    it('filters history by search, agent, status and date range', async () => {
      prisma.chatSession.findMany.mockResolvedValue([]);
      await service.history({ search: 'jane', agentId: 'a1', status: 'CLOSED', from: '2026-01-01', to: '2026-08-01' });
      const [call] = prisma.chatSession.findMany.mock.calls;
      const where: any = call[0].where;
      expect(where.agentId).toBe('a1');
      expect(where.status).toBe('CLOSED');
      expect(where.OR).toEqual(expect.any(Array));
      expect(where.createdAt.gte).toEqual(new Date('2026-01-01'));
      expect(where.createdAt.lte).toEqual(new Date('2026-08-01'));
      expect(call[0].take).toBe(200);
    });
  });
});