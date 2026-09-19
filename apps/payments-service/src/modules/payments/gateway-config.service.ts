import { Injectable, Logger } from '@nestjs/common';
import { decryptSecret } from '@isp/prisma';
import { PrismaService } from '../../common/prisma/prisma.service';
const CACHE_TTL_MS = 30_000;

/**
 * Resolves gateway secret keys configured from the admin UI (encrypted on
 * the Tenant row), falling back to env vars for environments that
 * have not migrated to DB-stored credentials yet.
 * Supports Paystack (default) + Flutterwave + generic OTHER.
 */
@Injectable()
export class GatewayConfigService {
  private readonly logger = new Logger(GatewayConfigService.name);
  private cache: { key: string; at: number } | null = null;
  private fwCache: { key: string; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private envKey(): string {
    return process.env.PAYSTACK_SECRET_KEY ?? '';
  }

  private envFlutterwaveKey(): string {
    return process.env.FLUTTERWAVE_SECRET_KEY ?? process.env.FLW_SECRET_KEY ?? '';
  }

  private async decryptTenantKey(tenantId: string | null | undefined): Promise<string | null> {
    if (!tenantId) return null;
    try {
      const row = await this.prisma.tenant?.findUnique({
        where: { id: tenantId },
        select: { paystackEnabled: true, paystackSecretKeyEnc: true },
      });
      if (!row?.paystackEnabled || !row.paystackSecretKeyEnc) return null;
      return decryptSecret(row.paystackSecretKeyEnc);
    } catch (e: any) {
      this.logger.warn(`Could not read tenant Paystack key: ${e?.message ?? e}`);
      return null;
    }
  }

  private async decryptFlutterwaveKey(tenantId: string | null | undefined): Promise<string | null> {
    if (!tenantId) return null;
    try {
      const row = await this.prisma.tenant?.findUnique({
        where: { id: tenantId },
        select: { flutterwaveEnabled: true, flutterwaveSecretKeyEnc: true } as any,
      } as any);
      const r: any = row as any;
      if (!r?.flutterwaveEnabled || !r?.flutterwaveSecretKeyEnc) return null;
      return decryptSecret(r.flutterwaveSecretKeyEnc);
    } catch (e: any) {
      this.logger.warn(`Could not read tenant Flutterwave key: ${e?.message ?? e}`);
      return null;
    }
  }

  /** Request-scoped (tenant from AsyncLocalStorage). Cached briefly. */
  async getPaystackSecret(): Promise<string> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.key;
    let key: string | null = null;
    try {
      key = await this.decryptTenantKey((await this.prisma.tenant?.findFirst())?.id);
    } catch {
      key = null;
    }
    const resolved = key || this.envKey();
    this.cache = { key: resolved, at: Date.now() };
    return resolved;
  }

  async getFlutterwaveSecret(): Promise<string> {
    if (this.fwCache && Date.now() - this.fwCache.at < CACHE_TTL_MS) return this.fwCache.key;
    let key: string | null = null;
    try {
      key = await this.decryptFlutterwaveKey((await this.prisma.tenant?.findFirst())?.id);
    } catch {
      key = null;
    }
    const resolved = key || this.envFlutterwaveKey();
    this.fwCache = { key: resolved, at: Date.now() };
    return resolved;
  }

  /** Resolve active payment provider from Tenant (PAYSTACK default). */
  async getActiveProvider(): Promise<string> {
    try {
      const tenant = await this.prisma.tenant?.findFirst({ select: { paymentProvider: true } as any } as any);
      const provider = (tenant as any)?.paymentProvider;
      if (provider) return String(provider).toUpperCase();
    } catch {}
    return 'PAYSTACK';
  }

  async getActiveProviderForReference(reference: string): Promise<string> {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { reference },
        select: { invoice: { select: { subscriber: { select: { tenantId: true } } } } },
      });
      const tenantId = payment?.invoice?.subscriber?.tenantId;
      if (tenantId) {
        const tenant = await this.prisma.tenant?.findUnique({ where: { id: tenantId }, select: { paymentProvider: true } as any } as any);
        const provider = (tenant as any)?.paymentProvider;
        if (provider) return String(provider).toUpperCase();
      }
    } catch {}
    return this.getActiveProvider();
  }

  /**
   * Webhook path — no tenant context. Resolve the tenant from the payment
   * reference (payment → invoice → subscriber → tenant).
   */
  async getPaystackSecretForReference(reference: string): Promise<string> {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { reference },
        select: { invoice: { select: { subscriber: { select: { tenantId: true } } } } },
      });
      const key = await this.decryptTenantKey(payment?.invoice?.subscriber?.tenantId);
      if (key) return key;
    } catch {
      // fall through to env
    }
    return this.envKey();
  }

  async getFlutterwaveSecretForReference(reference: string): Promise<string> {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { reference },
        select: { invoice: { select: { subscriber: { select: { tenantId: true } } } } },
      });
      const key = await this.decryptFlutterwaveKey(payment?.invoice?.subscriber?.tenantId);
      if (key) return key;
    } catch {
      // fall through
    }
    return this.envFlutterwaveKey();
  }

  async getFlutterwaveWebhookSecret(): Promise<string> {
    try {
      const tenant = await this.prisma.tenant?.findFirst({ select: { flutterwaveWebhookSecretEnc: true } as any } as any);
      const enc = (tenant as any)?.flutterwaveWebhookSecretEnc;
      if (enc) return decryptSecret(enc) ?? '';
    } catch {}
    return process.env.FLUTTERWAVE_WEBHOOK_SECRET ?? process.env.FLW_WEBHOOK_SECRET ?? '';
  }
}
