import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { SupportService, AGENT_ROLES } from './support.service';

interface SocketIdentity {
  userId: string;
  email: string;
  tenantId: string;
  role: 'agent' | 'customer';
  isSuperAdmin: boolean;
  customRoleName: string | null;
}

@WebSocketGateway({
  namespace: '/chat',
  cors: {
      origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
        const allowed = ['http://localhost:3000', 'http://localhost:3001', 'http://10.169.146.56:3000', 'http://10.169.146.56:3001'];
        cb(null, !origin || allowed.includes(origin) || /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin));
      },
      credentials: true,
    },
})
export class SupportGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SupportGateway.name);
  private readonly agentConnections = new Map<string, Set<string>>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly support: SupportService,
    private readonly jwt: JwtService,
  ) {}

  // ─────────────────────────── Connection auth ───────────────────────────

  async handleConnection(client: Socket) {
    try {
      const identity = await this.authenticate(client);
      if (!identity) {
        client.disconnect();
        return;
      }

      client.data.identity = identity;

      if (identity.role === 'agent') {
        client.join('agents');
        const sockets = this.agentConnections.get(identity.userId) ?? new Set();
        sockets.add(client.id);
        this.agentConnections.set(identity.userId, sockets);

        if (sockets.size === 1) {
          this.server.to('agents').emit('agent:online', { userId: identity.userId, email: identity.email });
        }
        await TenantContext.run(identity.tenantId, () =>
          this.support.setPresence(identity.userId, 'ONLINE'),
        );
      } else {
        client.join('customers');
      }
    } catch (err) {
      this.logger.warn(`Chat connection rejected: ${(err as Error).message}`);
      client.disconnect();
    }
  }

  private async authenticate(client: Socket): Promise<SocketIdentity | null> {
    const authToken =
      (client.handshake.auth as any)?.token ??
      (client.handshake.query?.token as string | undefined);
    const fallbackUserId = client.handshake.query?.userId as string | undefined;
    const fallbackRole = client.handshake.query?.role as string | undefined;

    let userId: string | null = null;

    if (authToken) {
      const stripped = String(authToken).replace(/^Bearer\s+/i, '').trim();
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string }>(stripped, {
          secret: process.env.JWT_ACCESS_SECRET ?? 'change-me',
        });
        userId = payload.sub;
      } catch {
        this.logger.warn('Socket JWT verification failed');
      }
    }

    if (!userId && fallbackUserId) userId = fallbackUserId;

    if (!userId) return null;

    // Tenant comes from the DB record — never trust the client's claim
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        tenantId: true,
        isSuperAdmin: true,
        customRole: { select: { name: true } },
      },
    });
    if (!user) return null;

    if (fallbackRole === 'agent') {
      if (!user.isSuperAdmin && !AGENT_ROLES.includes(user.customRole?.name ?? '')) return null;
      return {
        userId: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: 'agent',
        isSuperAdmin: user.isSuperAdmin,
        customRoleName: user.customRole?.name ?? null,
      };
    }

    return {
      userId: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: 'customer',
      isSuperAdmin: user.isSuperAdmin,
      customRoleName: user.customRole?.name ?? null,
    };
  }

  async handleDisconnect(client: Socket) {
    const identity: SocketIdentity | undefined = client.data.identity;
    if (!identity) return;

    if (identity.role !== 'agent') return;

    const sockets = this.agentConnections.get(identity.userId);
    if (sockets) {
      sockets.delete(client.id);
      if (sockets.size === 0) {
        this.agentConnections.delete(identity.userId);
        this.server.to('agents').emit('agent:offline', { userId: identity.userId });
      }
    }
    await TenantContext.run(identity.tenantId, () =>
      this.support.setPresence(identity.userId, 'OFFLINE'),
    );
  }

  // ─────────────────────────── client events ───────────────────────────

  private async canAccessSession(identity: SocketIdentity, sessionId: string): Promise<boolean> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { tenantId: true, subscriberId: true, agentId: true },
    });
    if (!session) return false;
    if (session.tenantId !== identity.tenantId) return false;

    if (identity.role === 'agent') {
      if (identity.isSuperAdmin) return true;
      const isAgentRole = AGENT_ROLES.includes(identity.customRoleName ?? '');
      const isAssigned = session.agentId === identity.userId || session.agentId === null;
      return isAgentRole && (isAssigned || session.subscriberId === null);
    }

    const isOwner = session.subscriberId
      ? !!(await this.prisma.subscriber.findFirst({
          where: { id: session.subscriberId, userId: identity.userId },
          select: { id: true },
        }))
      : false;
    return isOwner;
  }

  @SubscribeMessage('chat:getAgents')
  handleGetAgents(client: Socket) {
    client.emit('agent:count', this.agentConnections.size);
  }

  @SubscribeMessage('chat:join')
  async handleJoin(client: Socket, sessionId: string) {
    const identity: SocketIdentity = client.data.identity;
    if (!identity) return;
    const allowed = await TenantContext.run(identity.tenantId, () => this.canAccessSession(identity, sessionId));
    if (!allowed) {
      client.emit('chat:error', { message: 'Access denied to session' });
      return;
    }
    client.join(`session:${sessionId}`);
  }

  @SubscribeMessage('chat:leave')
  handleLeave(client: Socket, sessionId: string) {
    client.leave(`session:${sessionId}`);
  }

  @SubscribeMessage('chat:typing')
  handleTyping(client: Socket, data: { sessionId: string; isTyping: boolean }) {
    const identity: SocketIdentity = client.data.identity;
    if (!identity) return;
    client.to(`session:${data.sessionId}`).emit('chat:typing', {
      sessionId: data.sessionId,
      userId: identity.userId,
      isTyping: data.isTyping,
    });
  }

  @SubscribeMessage('chat:message')
  async handleMessage(client: Socket, data: { sessionId: string; body: string; attachmentIds?: string[] }) {
    const identity: SocketIdentity = client.data.identity;
    if (!identity) return;
    if (!data?.body?.trim()) return;

    try {
      const msg = await TenantContext.run(identity.tenantId, () =>
        this.support.sendMessage({
          sessionId: data.sessionId,
          actor: {
            id: identity.userId,
            email: identity.email,
            isSuperAdmin: identity.isSuperAdmin,
            customRole: { name: identity.customRoleName ?? '' },
          },
          senderType: identity.role === 'agent' ? 'AGENT' : 'CUSTOMER',
          body: data.body,
          attachmentIds: Array.isArray(data.attachmentIds) ? data.attachmentIds : undefined,
        }),
      );
      this.broadcastMessage(msg);
    } catch (err) {
      this.logger.error(`chat:message error: ${(err as Error).message}`);
      client.emit('chat:error', { message: (err as Error).message || 'Failed to send message' });
    }
  }

  @SubscribeMessage('chat:read')
  async handleRead(client: Socket, sessionId: string) {
    const identity: SocketIdentity = client.data.identity;
    if (!identity) return;
    try {
      const result = await TenantContext.run(identity.tenantId, () =>
        this.support.markSessionRead(sessionId, {
          id: identity.userId,
          email: identity.email,
          isSuperAdmin: identity.isSuperAdmin,
          customRole: { name: identity.customRoleName ?? '' },
        }),
      );
      if (result.updated > 0) {
        this.broadcastRead(sessionId, result.senderType);
        this.server.to('agents').emit('chat:changed', { sessionId });
      }
    } catch (err) {
      this.logger.error(`chat:read error: ${(err as Error).message}`);
    }
  }

  // ─────────────────────────── server broadcasts ───────────────────────────

  broadcastMessage(msg: any) {
    this.server.to(`session:${msg.sessionId}`).emit('chat:message', msg);
    this.server.to('agents').emit('chat:activity', { sessionId: msg.sessionId });
  }

  broadcastNewSession(session: any) {
    this.server.to('agents').emit('chat:new', {
      sessionId: session.id,
      customerName: session.customerName,
      customerEmail: session.customerEmail,
    });
  }

  broadcastSessionChanged(sessionId: string) {
    this.server.to('agents').emit('chat:changed', { sessionId });
    this.server.to(`session:${sessionId}`).emit('chat:sessionChanged', { sessionId });
  }

  broadcastAssigned(sessionId: string, agentId: string) {
    this.server.to(`session:${sessionId}`).emit('chat:assigned', { sessionId, agentId });
    this.server.to('agents').emit('chat:changed', { sessionId });
  }

  broadcastRead(sessionId: string, senderType: string) {
    this.server.to(`session:${sessionId}`).emit('chat:read', {
      sessionId,
      senderType,
      readAt: new Date().toISOString(),
    });
  }
}