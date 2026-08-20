import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContext } from '../tenant/tenant-context';

const TENANT_MODELS = new Set([
  'CustomRole',
  'User',
  'Subscriber',
  'Plan',
  'NetworkDevice',
  'Notification',
  'ActionQueue',
  'ChatSession',
  'Ticket',
  'CannedResponse',
  'AgentPresence',
  'FileUpload',
  'RouterSnapshot',
  'RouterMetric',
  'RouterUsageDay',
]);

const WHERE_OPS = new Set([
  'findMany',
  'findFirst',
  'count',
  'aggregate',
  'updateMany',
  'deleteMany',
]);

function wrapDelegate<T>(modelName: string, delegate: T): T {
  return new Proxy(delegate as Record<string, unknown>, {
    get(target: Record<string, unknown>, prop: string) {
      const original = target[prop];
      if (typeof original !== 'function') return original;
      return (...args: unknown[]) => {
        const tenantId = TenantContext.getTenantId();
        if (tenantId && TENANT_MODELS.has(modelName)) {
          const opts = args[0] as Record<string, unknown>;
          if (prop === 'create' && opts?.data) {
            opts.data = { ...(opts.data as Record<string, unknown>), tenant: { connect: { id: tenantId } } };
          } else if (WHERE_OPS.has(prop)) {
            opts.where = { ...((opts.where as Record<string, unknown>) ?? {}), tenantId };
          }
        }
        return (original as Function).apply(this, args);
      };
    },
  }) as unknown as T;
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private client = new PrismaClient(
    process.env.DATABASE_REPLICA_URL
      ? { datasources: { db: { url: process.env.DATABASE_REPLICA_URL } } }
      : undefined,
  );

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }

  $queryRaw<T = unknown>(query: TemplateStringsArray | string, ...values: unknown[]): Promise<T> {
    return this.client.$queryRaw(query as any, ...values) as Promise<T>;
  }

  get user() { return wrapDelegate('User', this.client.user) as typeof this.client.user; }
  get subscriber() { return wrapDelegate('Subscriber', this.client.subscriber) as typeof this.client.subscriber; }
  get plan() { return wrapDelegate('Plan', this.client.plan) as typeof this.client.plan; }
  get invoice() { return this.client.invoice; }
  get payment() { return this.client.payment; }
  get invoiceLine() { return this.client.invoiceLine; }
  get paymentAttempt() { return this.client.paymentAttempt; }
  get paymentReconciliation() { return this.client.paymentReconciliation; }
  get receipt() { return this.client.receipt; }
  get refund() { return this.client.refund; }
  get quotation() { return this.client.quotation; }
  get quotationItem() { return this.client.quotationItem; }
  get creditNote() { return this.client.creditNote; }
  get wallet() { return this.client.wallet; }
  get walletTransaction() { return this.client.walletTransaction; }
  get virtualAccount() { return this.client.virtualAccount; }
  get tenant() { return this.client.tenant; }
  get customRole() { return wrapDelegate('CustomRole', this.client.customRole) as typeof this.client.customRole; }
  get networkDevice() { return wrapDelegate('NetworkDevice', this.client.networkDevice) as typeof this.client.networkDevice; }
  get subscription() { return this.client.subscription; }
  get cpe() { return this.client.cpe; }
  get contract() { return this.client.contract; }
  get ticket() { return wrapDelegate('Ticket', this.client.ticket) as typeof this.client.ticket; }
  get ticketComment() { return this.client.ticketComment; }
  get chatSession() { return wrapDelegate('ChatSession', this.client.chatSession) as typeof this.client.chatSession; }
  get chatMessage() { return this.client.chatMessage; }
  get fileUpload() { return wrapDelegate('FileUpload', this.client.fileUpload) as typeof this.client.fileUpload; }
  get cannedResponse() { return wrapDelegate('CannedResponse', this.client.cannedResponse) as typeof this.client.cannedResponse; }
  get agentPresence() { return wrapDelegate('AgentPresence', this.client.agentPresence) as typeof this.client.agentPresence; }
  get auditLog() { return this.client.auditLog; }
  get notification() { return wrapDelegate('Notification', this.client.notification) as typeof this.client.notification; }
  get refreshToken() { return this.client.refreshToken; }
  get permission() { return this.client.permission; }
  get pppoeSession() { return this.client.pppoeSession; }
  get routerHealth() { return this.client.routerHealth; }
  get routerSnapshot() { return this.client.routerSnapshot; }
  get routerMetric() { return this.client.routerMetric; }
  get routerUsageDay() { return this.client.routerUsageDay; }
  get actionQueue() { return wrapDelegate('ActionQueue', this.client.actionQueue) as typeof this.client.actionQueue; }
  get passwordResetToken() { return this.client.passwordResetToken; }

  get $transaction() { return this.client.$transaction.bind(this.client); }
  get $connect() { return this.client.$connect.bind(this.client); }
  get $disconnect() { return this.client.$disconnect.bind(this.client); }
  get $on() { return this.client.$on.bind(this.client); }
}
