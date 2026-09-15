import { Injectable, Logger } from '@nestjs/common';
import { decryptSecret } from '@isp/prisma';
import { PrismaService } from '../../common/prisma/prisma.service';
const CACHE_TTL_MS = 30_000;

/**
 * Resolves the Paystack secret key configured from the admin UI (encrypted on
 * the Tenant row), falling back to PAYSTACK_SECRET_KEY for environments that
 * have not migrated to DB-stored credentials yet.
 */
@Injectable()
export class GatewayConfigService {
  private readonly logger = new Logger(GatewayConfigService.name);
  private cache: { key: string; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService) {}

  private envKey(): string {
    return process.env.PAYSTACK_SECRET_KEY ?? '';
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
}
