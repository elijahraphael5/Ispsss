import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantService } from '../../common/tenant/tenant.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from '../audit-logs/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export const AGENT_ROLES = ['SUPER_ADMIN', 'SUPPORT_AGENT', 'CUSTOMER_SUPPORT'];

const SLA_HOURS: Record<string, number> = { LOW: 48, MEDIUM: 24, HIGH: 8, URGENT: 2 };

interface Actor {
  id: string;
  email: string;
  isSuperAdmin: boolean;
  customRole?: { name: string } | null;
}

function isAgentActor(actor: Actor): boolean {
  if (actor.isSuperAdmin) return true;
  return AGENT_ROLES.includes(actor.customRole?.name ?? '');
}

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─────────────────────────── Chat sessions ───────────────────────────

  async createSession(data: {
    userId: string;
    email: string;
    department?: string;
  }) {
    const tenantId = await this.tenant.resolveTenant();
    const subscriber = await this.prisma.subscriber.findFirst({
      where: { userId: data.userId, deletedAt: null },
      select: { id: true },
    });

    if (subscriber) {
      const open = await this.prisma.chatSession.findFirst({
        where: { subscriberId: subscriber.id, status: { in: ['WAITING', 'ACTIVE'] } },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
        orderBy: { updatedAt: 'desc' },
      });
      if (open) return open;
    }

    const session = await this.prisma.chatSession.create({
      data: {
        tenantId,
        subscriberId: subscriber?.id ?? null,
        customerName: data.email.split('@')[0] || null,
        customerEmail: data.email,
        department: data.department ?? null,
        status: 'WAITING',
      },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    await this.audit.log({
      action: 'CHAT_SESSION_CREATED',
      entityType: 'ChatSession',
      entityId: session.id,
      metadata: { customerEmail: data.email },
    });
    return session;
  }

  async getCustomerSessions(userId: string) {
    const subscriber = await this.prisma.subscriber.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    if (!subscriber) return [];
    return this.prisma.chatSession.findMany({
      where: { subscriberId: subscriber.id },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listSessions(actor: Actor, scope?: string) {
    const where: any = {};
    if (scope === 'queue') {
      where.status = 'WAITING';
      where.agentId = null;
    } else if (scope === 'assigned') {
      where.agentId = actor.id;
      where.status = { in: ['WAITING', 'ACTIVE'] };
    } else if (scope === 'closed') {
      where.agentId = actor.id;
      where.status = 'CLOSED';
    }

    const sessions = await this.prisma.chatSession.findMany({
      where,
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
    });

    const rows = await Promise.all(
      sessions.map(async (s) => {
        const unread = await this.prisma.chatMessage.count({
          where: { sessionId: s.id, senderType: 'CUSTOMER', readAt: null },
        });
        const last = (s as any).messages?.[0] ?? null;
        return {
          id: s.id,
          customerName: s.customerName,
          customerEmail: s.customerEmail,
          status: s.status,
          department: s.department,
          agentId: s.agentId,
          csat: s.csat,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          closedAt: s.closedAt,
          lastMessage: last
            ? { body: last.body, senderType: last.senderType, createdAt: last.createdAt }
            : null,
          unreadCount: unread,
        };
      }),
    );
    return rows;
  }

  async getSession(id: string, actor?: Actor) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, include: { attachments: true } },
        agent: { select: { id: true, email: true } },
        tickets: { select: { id: true, subject: true, status: true } },
        subscriber: {
          select: {
            id: true,
            status: true,
            type: true,
            address: true,
            createdAt: true,
            user: { select: { id: true, email: true, phone: true } },
            subscriptions: {
              orderBy: { startedAt: 'desc' },
              take: 1,
              include: {
                plan: { select: { id: true, name: true, speedMbps: true, priceKobo: true, technology: true, staticIp: true } },
              },
            },
            devices: { take: 3, select: { id: true, name: true, macAddress: true, ipAddress: true, status: true, connectionType: true } },
            invoices: {
              orderBy: { createdAt: 'desc' },
              take: 6,
              select: { id: true, invoiceNumber: true, status: true, amountKobo: true, dueAt: true, paidAt: true },
            },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Chat session not found');

    if (actor) {
      const isAgent = isAgentActor(actor);
      const isOwner = session.subscriberId && session.subscriber?.user?.id === actor.id;
      if (!isAgent && !isOwner) throw new ForbiddenException('Access denied');
    }

    return session;
  }

  // ─────────────────────────── performance/history ───────────────────────────

  async sendMessage(data: {
    sessionId: string;
    actor?: Actor;
    senderId?: string;
    senderName?: string;
    senderType: 'CUSTOMER' | 'AGENT';
    body: string;
    attachmentIds?: string[];
    persisted?: boolean;
  }) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: data.sessionId } });
    if (!session) throw new NotFoundException('Chat session not found');

    if (session.status === 'CLOSED') throw new BadRequestException('Chat session is closed');

    if (data.actor) {
      const isAgent = isAgentActor(data.actor);
      let isOwner = false;
      if (session.subscriberId) {
        isOwner = !!(await this.prisma.subscriber.findFirst({
          where: { id: session.subscriberId, userId: data.actor.id },
          select: { id: true },
        }));
      }
      if (!isAgent && !isOwner) throw new ForbiddenException('Access denied');
    }

    const senderId = data.senderId ?? data.actor?.id ?? null;
    const senderName = data.senderName ?? (data.actor ? data.actor.email.split('@')[0] : null);

    const message = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        senderId,
        senderName,
        senderType: data.senderType,
        body: data.body,
        status: 'SENT',
      },
    });

    if (data.attachmentIds?.length) {
      await this.prisma.fileUpload.updateMany({
        where: { id: { in: data.attachmentIds }, sessionId: session.id, messageId: null, uploadedById: senderId },
        data: { messageId: message.id },
      });
    }

    const update: any = {};
    if (data.senderType === 'AGENT') {
      update.status = 'ACTIVE';
      if (session.firstResponseAt === null) update.firstResponseAt = new Date();
      if (session.agentId === null) update.agentId = senderId;
    }
    if (Object.keys(update).length > 0) {
      await this.prisma.chatSession.update({ where: { id: session.id }, data: update });
    }

    return this.prisma.chatMessage.findUnique({
      where: { id: message.id },
      include: { attachments: true },
    });
  }

  async pickUp(sessionId: string, actor: Actor) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Chat session not found');
    if (session.status === 'CLOSED') throw new BadRequestException('Chat session is closed');

    const before = { status: session.status, agentId: session.agentId };
    const updated = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { agentId: actor.id, status: 'ACTIVE' },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'CHAT_SESSION_ASSIGNED',
      entityType: 'ChatSession',
      entityId: sessionId,
      beforeData: before as any,
      afterData: { agentId: actor.id, status: updated.status } as any,
    });
    return updated;
  }

  async reassign(sessionId: string, toAgentId: string, actor: Actor) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Chat session not found');
    if (!actor.isSuperAdmin && session.agentId && session.agentId !== actor.id) {
      throw new ForbiddenException('Only the assigned agent can transfer this chat');
    }

    const before = { status: session.status, agentId: session.agentId };
    const updated = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { agentId: toAgentId, status: 'ACTIVE' },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'CHAT_SESSION_REASSIGNED',
      entityType: 'ChatSession',
      entityId: sessionId,
      beforeData: before as any,
      afterData: { agentId: toAgentId, status: updated.status } as any,
    });
    return updated;
  }

  async closeSession(sessionId: string, actor: Actor) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Chat session not found');

    const isAgent = isAgentActor(actor);
    const isOwner = session.subscriberId
      ? await this.prisma.subscriber.findFirst({ where: { id: session.subscriberId, userId: actor.id }, select: { id: true } })
      : null;
    if (!isAgent && !isOwner) throw new ForbiddenException('Access denied');

    if (session.status === 'CLOSED') return session;

    const before = { status: session.status };
    const updated = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'CHAT_SESSION_CLOSED',
      entityType: 'ChatSession',
      entityId: sessionId,
      beforeData: before as any,
      afterData: { status: 'CLOSED' } as any,
    });
    return updated;
  }

  async markSessionRead(sessionId: string, actor: Actor) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Chat session not found');

    const isAgent = isAgentActor(actor);
    const unreadSenderType = isAgent ? 'CUSTOMER' : 'AGENT';
    const result = await this.prisma.chatMessage.updateMany({
      where: { sessionId, senderType: unreadSenderType as any, readAt: null },
      data: { readAt: new Date(), status: 'READ' },
    });
    return { updated: result.count, senderType: unreadSenderType };
  }

  async rateSession(sessionId: string, actor: Actor, rating: number) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Chat session not found');
    const isOwner = session.subscriberId
      ? await this.prisma.subscriber.findFirst({ where: { id: session.subscriberId, userId: actor.id }, select: { id: true } })
      : null;
    if (!isOwner) throw new ForbiddenException('Only the customer can rate a chat');

    if (session.csat !== null) throw new BadRequestException('Chat already rated');
    return this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { csat: rating },
    });
  }

  async convertSessionToTicket(sessionId: string, actor: Actor, body: { subject?: string; description?: string }) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { subscriber: { select: { id: true } } },
    });
    if (!session) throw new NotFoundException('Chat session not found');

    const existing = await this.prisma.ticket.findUnique({ where: { sourceChatSessionId: sessionId } });
    if (existing) return existing;

    if (!session.subscriber?.id) throw new BadRequestException('Session has no linked customer account');

    const subject = body.subject?.trim() || `Chat: ${session.customerName || session.customerEmail || 'Support Request'}`;
    const ticket = await this.prisma.ticket.create({
      data: {
        tenantId: session.tenantId,
        subscriberId: session.subscriber.id,
        subject,
        description: body.description,
        category: session.department ?? 'LIVE_CHAT',
        priority: 'MEDIUM',
        status: 'OPEN',
        slaDueAt: new Date(Date.now() + SLA_HOURS['MEDIUM'] * 60 * 60 * 1000),
        sourceChatSessionId: sessionId,
      },
    });

    await this.audit.log({
      actorId: actor.id,
      action: 'TICKET_CREATED',
      entityType: 'Ticket',
      entityId: ticket.id,
      afterData: { subject, priority: 'MEDIUM', status: 'OPEN', sourceChatSessionId: sessionId } as any,
      metadata: { fromChatSession: sessionId },
    });
    return ticket;
  }

  // ─────────────────────────── Agents & presence ───────────────────────────

  async setPresence(userId: string, status: 'ONLINE' | 'AWAY' | 'OFFLINE') {
    const tenantId = await this.tenant.resolveTenant();
    return this.prisma.agentPresence.upsert({
      where: { userId },
      create: { tenantId, userId, status, lastSeenAt: new Date() },
      update: { status, lastSeenAt: status === 'OFFLINE' ? undefined : new Date() },
    });
  }

  async listAgents() {
    const users = await this.prisma.user.findMany({
      where: {
        customRole: { name: { in: AGENT_ROLES } },
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        customRole: { select: { name: true } },
        agentPresence: { select: { status: true, lastSeenAt: true } },
      },
      orderBy: { email: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.email.split('@')[0],
      role: u.customRole?.name ?? null,
      presence: u.agentPresence?.status ?? 'OFFLINE',
      lastSeenAt: u.agentPresence?.lastSeenAt ?? null,
    }));
  }

  async listCustomers(search?: string) {
    return this.prisma.subscriber.findMany({
      where: {
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { user: { email: { contains: search, mode: 'insensitive' as const } } },
                { user: { phone: { contains: search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        status: true,
        user: { select: { id: true, email: true, phone: true } },
        subscriptions: {
          orderBy: { startedAt: 'desc' as const },
          take: 1,
          select: { plan: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' as const },
      take: 20,
    });
  }

  // ─────────────────────────── Canned responses ───────────────────────────

  async listCanned() {
    return this.prisma.cannedResponse.findMany({ orderBy: { category: 'asc' } });
  }

  async createCanned(data: { title: string; body: string; category?: string }) {
    const tenantId = await this.tenant.resolveTenant();
    return this.prisma.cannedResponse.create({ data: { tenantId, ...data } });
  }

  async updateCanned(id: string, data: { title?: string; body?: string; category?: string | null }) {
    return this.prisma.cannedResponse.update({ where: { id }, data: data as any });
  }

  async deleteCanned(id: string) {
    return this.prisma.cannedResponse.delete({ where: { id } });
  }

  async useCanned(id: string) {
    return this.prisma.cannedResponse.update({ where: { id }, data: { usageCount: { increment: 1 } } });
  }

  // ─────────────────────────── Tickets ───────────────────────────

  async listTickets(params: { status?: string; priority?: string; search?: string }) {
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.priority) where.priority = params.priority;
    if (params.search) {
      where.OR = [
        { subject: { contains: params.search, mode: 'insensitive' } },
        { subscriber: { user: { email: { contains: params.search, mode: 'insensitive' } } } },
        { subscriber: { user: { phone: { contains: params.search, mode: 'insensitive' } } } },
      ];
    }
    return this.prisma.ticket.findMany({
      where,
      include: {
        subscriber: { select: { id: true, user: { select: { id: true, email: true, phone: true } } } },
        assignedAgent: { select: { id: true, email: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getTicket(id: string) {
    return this.prisma.ticket.findUniqueOrThrow({
      where: { id },
      include: {
        subscriber: {
          select: {
            id: true,
            status: true,
            user: { select: { id: true, email: true, phone: true } },
            subscriptions: { orderBy: { startedAt: 'desc' }, take: 1, include: { plan: { select: { name: true, speedMbps: true } } } },
          },
        },
        assignedAgent: { select: { id: true, email: true } },
        sourceChatSession: { select: { id: true, status: true, customerName: true, customerEmail: true } },
        comments: { orderBy: { createdAt: 'asc' }, include: { attachments: true } },
      },
    });
  }

  async createTicket(data: {
    subscriberId: string;
    subject: string;
    description?: string;
    category?: string;
    priority?: string;
    assignedAgentId?: string;
  }) {
    const tenantId = await this.tenant.resolveTenant();
    const priority = data.priority ?? 'MEDIUM';
    const ticket = await this.prisma.ticket.create({
      data: {
        tenantId,
        subscriberId: data.subscriberId,
        subject: data.subject,
        description: data.description ?? null,
        category: data.category ?? null,
        priority: priority as any,
        status: 'OPEN',
        slaDueAt: new Date(Date.now() + (SLA_HOURS[priority] ?? 24) * 60 * 60 * 1000),
        assignedAgentId: data.assignedAgentId ?? null,
      },
    });

    await this.audit.log({
      action: 'TICKET_CREATED',
      entityType: 'Ticket',
      entityId: ticket.id,
      afterData: { subject: data.subject, priority, status: 'OPEN', subscriberId: data.subscriberId } as any,
    });

    if (priority === 'HIGH' || priority === 'URGENT') {
      await this.notifications.create({
        title: `${priority}: ${data.subject}`,
        message: `Ticket from subscriber ${data.subscriberId}`,
        type: 'ERROR',
        link: '/tickets',
      });
    }
    return ticket;
  }

  async updateTicket(id: string, data: { status?: string; priority?: string; assignedAgentId?: string | null; subject?: string }, actor: Actor) {
    const before = await this.prisma.ticket.findUniqueOrThrow({ where: { id } });

    const updateData: any = { ...data };
    if (data.status === 'RESOLVED' || data.status === 'CLOSED') updateData.resolvedAt = new Date();

    const updated = await this.prisma.ticket.update({ where: { id }, data: updateData });

    await this.audit.log({
      actorId: actor.id,
      action: 'TICKET_UPDATED',
      entityType: 'Ticket',
      entityId: id,
      beforeData: {
        subject: before.subject,
        status: before.status,
        priority: before.priority,
        assignedAgentId: before.assignedAgentId,
      } as any,
      afterData: {
        subject: updated.subject,
        status: updated.status,
        priority: updated.priority,
        assignedAgentId: updated.assignedAgentId,
      } as any,
    });
    return updated;
  }

  async addTicketComment(
    ticketId: string,
    data: { body: string; internal?: boolean; attachmentIds?: string[] },
    actor: Actor,
    authorType: 'AGENT' | 'CUSTOMER' = 'AGENT',
  ) {
    const ticket = await this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    if (data.internal && !isAgentActor(actor)) throw new ForbiddenException('Only agents can post internal notes');

    const comment = await this.prisma.ticketComment.create({
      data: {
        ticketId,
        authorId: actor.id,
        author: actor.email,
        authorType,
        body: data.body,
        internal: data.internal ?? false,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'TICKET_COMMENT_ADDED',
      entityType: 'TicketComment',
      entityId: comment.id,
      metadata: { ticketId, internal: data.internal ?? false },
    });

    if (data.attachmentIds?.length) {
      await this.prisma.fileUpload.updateMany({
        where: { id: { in: data.attachmentIds }, ticketId, ticketCommentId: null, uploadedById: actor.id },
        data: { ticketCommentId: comment.id },
      });
    }
    return this.prisma.ticketComment.findUnique({
      where: { id: comment.id },
      include: { attachments: true },
    });
  }

  private get uploadRoot(): string {
    return process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads');
  }

  private async storeUpload(opts: {
    tenantId: string;
    relativeDir: string;
    uploadedById: string;
    sessionId?: string;
    ticketId?: string;
    file: { originalname: string; mimetype: string; size: number; buffer?: Buffer };
  }): Promise<any> {
    const { file } = opts;
    if (!file.buffer) throw new BadRequestException('Empty file upload');
    const ext = path.extname(file.originalname).slice(0, 12);
    const storedName = `${randomUUID()}${ext}`;
    const dir = path.join(this.uploadRoot, opts.relativeDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, storedName), file.buffer);

    const upload = await this.prisma.fileUpload.create({
      data: {
        tenantId: opts.tenantId,
        sessionId: opts.sessionId,
        ticketId: opts.ticketId,
        uploadedById: opts.uploadedById,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storedPath: path.posix.join(opts.relativeDir, storedName),
      },
    });
    return upload;
  }

  async saveChatAttachment(sessionId: string, actor: Actor, file: any): Promise<any> {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Chat session not found');
    if (session.status === 'CLOSED') throw new BadRequestException('Chat session is closed');

    const isAgent = isAgentActor(actor);
    let isOwner = false;
    if (session.subscriberId) {
      isOwner = !!(await this.prisma.subscriber.findFirst({
        where: { id: session.subscriberId, userId: actor.id },
        select: { id: true },
      }));
    }
    if (!isAgent && !isOwner) throw new ForbiddenException('Access denied');

    const tenantId = await this.tenant.resolveTenant();
    const upload = await this.storeUpload({
      tenantId,
      relativeDir: `chat/${sessionId}`,
      uploadedById: actor.id,
      sessionId: session.id,
      file,
    });
    return { ...upload, url: `/api/v1/chat/attachments/${upload.id}` };
  }

  async saveTicketAttachment(ticketId: string, actor: Actor, file: any): Promise<any> {
    const isAgent = isAgentActor(actor);
    if (!isAgent) throw new ForbiddenException('Only agents can upload ticket attachments');

    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const tenantId = await this.tenant.resolveTenant();
    const upload = await this.storeUpload({
      tenantId,
      relativeDir: `ticket/${ticketId}`,
      uploadedById: actor.id,
      ticketId: ticket.id,
      file,
    });
    return { ...upload, url: `/api/v1/chat/attachments/${upload.id}` };
  }

  async getAttachmentFile(id: string, actor: Actor): Promise<{
    absPath: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }> {
    const upload = await this.prisma.fileUpload.findUnique({
      where: { id },
      include: {
        session: { select: { tenantId: true, subscriberId: true } },
        ticket: { select: { tenantId: true, subscriberId: true } },
        ticketComment: { include: { ticket: { select: { tenantId: true, subscriberId: true } } } },
      },
    });
    if (!upload) throw new NotFoundException('Attachment not found');
    const tenantId = await this.tenant.resolveTenant();
    if (upload.tenantId !== tenantId) throw new ForbiddenException('Access denied');

    const isAgent = isAgentActor(actor);
    let accessible = isAgent;

    const ownedBySubscriberId =
      upload.session?.subscriberId ?? upload.ticket?.subscriberId ?? upload.ticketComment?.ticket.subscriberId;
    if (!accessible && ownedBySubscriberId) {
      const owned = await this.prisma.subscriber.findFirst({
        where: { id: ownedBySubscriberId, userId: actor.id },
        select: { id: true },
      });
      accessible = !!owned;
    }

    if (!accessible) throw new ForbiddenException('Access denied');

    const absPath = path.join(this.uploadRoot, upload.storedPath);
    if (!fs.existsSync(absPath)) throw new NotFoundException('Attachment file missing on disk');
    return {
      absPath,
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
    };
  }

  async createTicketForCustomer(userId: string, data: { subject: string; description?: string; category?: string; priority?: string }) {
    const tenantId = await this.tenant.resolveTenant();
    const subscriber = await this.prisma.subscriber.findFirst({
      where: { userId, deletedAt: null },
      include: { user: { select: { email: true } } },
    });
    if (!subscriber) throw new NotFoundException('Subscriber not found');

    const priority = data.priority ?? 'MEDIUM';
    const ticket = await this.prisma.ticket.create({
      data: {
        tenantId,
        subscriberId: subscriber.id,
        subject: data.subject,
        description: data.description ?? null,
        category: data.category ?? null,
        priority: priority as any,
        status: 'OPEN',
        slaDueAt: new Date(Date.now() + (SLA_HOURS[priority] ?? 24) * 60 * 60 * 1000),
      },
    });

    await this.prisma.ticketComment.create({
      data: {
        ticketId: ticket.id,
        authorId: userId,
        author: subscriber.user.email,
        authorType: 'CUSTOMER',
        body: data.description ?? data.subject,
        internal: false,
      },
    });

    await this.audit.log({
      actorId: userId,
      action: 'TICKET_CREATED',
      entityType: 'Ticket',
      entityId: ticket.id,
      afterData: { subject: data.subject, priority, status: 'OPEN', subscriberId: subscriber.id } as any,
      metadata: { source: 'customer_portal' },
    });

    if (priority === 'HIGH' || priority === 'URGENT') {
      await this.notifications.create({
        title: `${priority}: ${data.subject}`,
        message: `Ticket from ${subscriber.user.email}`,
        type: 'ERROR',
        link: '/tickets',
      });
    }
    return ticket;
  }

  // ─────────────────────────── History ───────────────────────────

  async history(params: { search?: string; agentId?: string; status?: string; from?: string; to?: string }) {
    const where: any = {};
    if (params.agentId) where.agentId = params.agentId;
    if (params.status) where.status = params.status;
    if (params.search) {
      where.OR = [
        { customerName: { contains: params.search, mode: 'insensitive' } },
        { customerEmail: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.from || params.to) {
      where.createdAt = {
        gte: params.from ? new Date(params.from) : undefined,
        lte: params.to ? new Date(params.to) : undefined,
      };
    }
    return this.prisma.chatSession.findMany({
      where,
      include: {
        agent: { select: { id: true, email: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
  }

  // ─────────────────────────── Performance metrics ───────────────────────────

  async performance(range: string) {
    const now = new Date();
    let since: Date;
    if (range === 'today') {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (range === 'week') {
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else {
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const agents = await this.listAgents();
    const rows = [];

    for (const agent of agents) {
      const sessions = await this.prisma.chatSession.findMany({
        where: { agentId: agent.id, createdAt: { gte: since } },
        select: { id: true, status: true, firstResponseAt: true, closedAt: true, createdAt: true, csat: true },
      });

      const handled = sessions.length;
      const closed = sessions.filter((s) => s.status === 'CLOSED');

      const firstResponseMs = sessions
        .filter((s) => s.firstResponseAt)
        .map((s) => s.firstResponseAt!.getTime() - s.createdAt.getTime());
      const durationMs = closed
        .filter((s) => s.closedAt)
        .map((s) => s.closedAt!.getTime() - s.createdAt.getTime());
      const csats = sessions.filter((s) => s.csat !== null).map((s) => s.csat as number);

      const ticketsResolved = await this.prisma.ticket.count({
        where: { assignedAgentId: agent.id, status: { in: ['RESOLVED', 'CLOSED'] }, updatedAt: { gte: since } },
      });

      rows.push({
        agentId: agent.id,
        name: agent.name,
        email: agent.email,
        role: agent.role,
        presence: agent.presence,
        chatsHandled: handled,
        closedChats: closed.length,
        resolutionRate: handled > 0 ? Math.round((closed.length / handled) * 100) : 0,
        avgFirstResponseSec: firstResponseMs.length > 0 ? Math.round(firstResponseMs.reduce((a, b) => a + b, 0) / firstResponseMs.length / 1000) : 0,
        avgDurationSec: durationMs.length > 0 ? Math.round(durationMs.reduce((a, b) => a + b, 0) / durationMs.length / 1000) : 0,
        avgCsat: csats.length > 0 ? Math.round((csats.reduce((a, b) => a + b, 0) / csats.length) * 10) / 10 : 0,
        ratedChats: csats.length,
        ticketsResolved,
      });
    }

    rows.sort((a, b) => b.chatsHandled - a.chatsHandled || b.ticketsResolved - a.ticketsResolved);

    const totals = rows.reduce(
      (acc, r) => ({
        chatsHandled: acc.chatsHandled + r.chatsHandled,
        closedChats: acc.closedChats + r.closedChats,
        ticketsResolved: acc.ticketsResolved + r.ticketsResolved,
        avgCsat: acc.avgCsat + r.avgCsat,
      }),
      { chatsHandled: 0, closedChats: 0, ticketsResolved: 0, avgCsat: 0 },
    );
    totals.avgCsat = rows.length > 0 ? Math.round((totals.avgCsat / rows.length) * 10) / 10 : 0;

    return {
      range,
      generatedAt: now,
      since,
      totals,
      agents: rows,
    };
  }
}
