import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { applyPrismaExtensions } from '@isp/prisma';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private client: PrismaClient = applyPrismaExtensions(
    new PrismaClient(
      (() => {
        const url = process.env.DATABASE_URL;
        if (!url) return undefined;
        // cap pool per service to 5 (7 services × 5 = 35 << max_connections 100)
        const hasLimit = url.includes('connection_limit=');
        const sep = url.includes('?') ? '&' : '?';
        const finalUrl = hasLimit ? url : `${url}${sep}connection_limit=5`;
        return { datasources: { db: { url: finalUrl } } };
      })(),
    ),
  ) as unknown as PrismaClient;

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }

  $queryRaw<T = unknown>(query: TemplateStringsArray | string, ...values: unknown[]): Promise<T> {
    return this.client.$queryRaw(query as any, ...values) as Promise<T>;
  }

  get user() { return this.client.user; }
  get subscriber() { return this.client.subscriber; }
  get plan() { return this.client.plan; }
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
  get customRole() { return this.client.customRole; }
  get networkDevice() { return this.client.networkDevice; }
  get subscription() { return this.client.subscription; }
  get cpe() { return this.client.cpe; }
  get contract() { return this.client.contract; }
  get ticket() { return this.client.ticket; }
  get ticketComment() { return this.client.ticketComment; }
  get chatSession() { return this.client.chatSession; }
  get chatMessage() { return this.client.chatMessage; }
  get fileUpload() { return this.client.fileUpload; }
  get cannedResponse() { return this.client.cannedResponse; }
  get agentPresence() { return this.client.agentPresence; }
  get auditLog() { return this.client.auditLog; }
  get notification() { return this.client.notification; }
  get refreshToken() { return this.client.refreshToken; }
  get permission() { return this.client.permission; }
  get pppoeSession() { return this.client.pppoeSession; }
  get routerHealth() { return this.client.routerHealth; }
  get routerSnapshot() { return this.client.routerSnapshot; }
  get routerMetric() { return this.client.routerMetric; }
  get routerUsageDay() { return this.client.routerUsageDay; }
  get actionQueue() { return this.client.actionQueue; }
  get coverageArea() { return this.client.coverageArea; }
  get coverageZone() { return (this.client as any).coverageZone; }
  get passwordResetToken() { return this.client.passwordResetToken; }

  get $transaction() { return this.client.$transaction.bind(this.client); }
  get $connect() { return this.client.$connect.bind(this.client); }
  get $disconnect() { return this.client.$disconnect.bind(this.client); }
  get $on() { return this.client.$on.bind(this.client); }
}
