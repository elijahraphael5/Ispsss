import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { decryptSecret, encryptSecret, maskSecret } from '@isp/prisma';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-logs/audit.service';
import { UpdateTenantSettingsDto } from './dto/tenant-settings.dto';

/**
 * Fields the admin Settings UI collects but that have no Tenant column yet.
 * Until the deferred schema work lands, PATCH logs them and reports them back
 * as `pending` instead of silently dropping the values.
 */
export const PENDING_TENANT_FIELDS = ['logoUrl', 'email', 'phone', 'address', 'vatRate', 'invoicePrefix'] as const;

@Injectable()
export class TenantSettingsService {
  private readonly logger = new Logger(TenantSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async getTenant() {
    const tenant = await this.prisma.tenant?.findFirst();
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async get() {
    const tenant = await this.getTenant();
    const secret = tenant.paystackEnabled ? decryptSecret(tenant.paystackSecretKeyEnc) : null;
    const fwSecret = (tenant as any).flutterwaveEnabled ? decryptSecret((tenant as any).flutterwaveSecretKeyEnc) : null;
    const provider = (tenant as any).paymentProvider ?? 'PAYSTACK';
    return {
      name: tenant.name,
      slug: tenant.slug,
      isActive: tenant.isActive,
      profile: {
        logoUrl: null,
        email: null,
        phone: null,
        address: null,
      },
      billing: {
        vatRate: 7.5,
        invoicePrefix: 'INV',
      },
      installation: {
        fiberFeeKobo: (tenant as any).fiberInstallationFeeKobo ?? 5000000,
        radioFeeKobo: (tenant as any).radioInstallationFeeKobo ?? 12000000,
      },
      paymentProvider: provider,
      paystack: {
        enabled: tenant.paystackEnabled,
        publicKey: tenant.paystackPublicKey ?? null,
        secretMasked: maskSecret(secret),
        hasSecret: !!tenant.paystackSecretKeyEnc,
      },
      flutterwave: {
        enabled: (tenant as any).flutterwaveEnabled ?? false,
        publicKey: (tenant as any).flutterwavePublicKey ?? null,
        secretMasked: maskSecret(fwSecret),
        hasSecret: !!(tenant as any).flutterwaveSecretKeyEnc,
        webhookSecretMasked: maskSecret((tenant as any).flutterwaveWebhookSecretEnc ? decryptSecret((tenant as any).flutterwaveWebhookSecretEnc) : null),
        hasWebhookSecret: !!(tenant as any).flutterwaveWebhookSecretEnc,
      },
      email: {
        enabled: tenant.smtpEnabled,
        host: tenant.smtpHost ?? null,
        port: tenant.smtpPort ?? null,
        user: tenant.smtpUser ?? null,
        passMasked: maskSecret(tenant.smtpEnabled ? decryptSecret(tenant.smtpPassEnc) : null),
        hasPass: !!tenant.smtpPassEnc,
        fromEmail: tenant.smtpFromEmail ?? null,
        fromName: tenant.smtpFromName ?? null,
      },
      persistedFields: ['name', 'paymentProvider', 'paystackEnabled', 'paystackPublicKey', 'paystackSecretKey', 'flutterwaveEnabled', 'flutterwavePublicKey', 'flutterwaveSecretKey', 'flutterwaveWebhookSecret', 'smtpEnabled', 'smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'smtpFromEmail', 'smtpFromName', 'fiberInstallationFeeKobo', 'radioInstallationFeeKobo'],
      pendingFields: [...PENDING_TENANT_FIELDS],
    };
  }

  async update(dto: UpdateTenantSettingsDto) {
    const tenant = await this.getTenant();
    const persisted: string[] = [];
    const pending: string[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const data: Record<string, unknown> = {};

    if (dto.name !== undefined) {
      const next = dto.name.trim();
      if (next && next !== tenant.name) {
        data.name = next;
        before.name = tenant.name;
        after.name = next;
      }
      persisted.push('name');
    }

    if (dto.paystackEnabled !== undefined) {
      data.paystackEnabled = dto.paystackEnabled;
      before.paystackEnabled = tenant.paystackEnabled;
      after.paystackEnabled = dto.paystackEnabled;
      persisted.push('paystackEnabled');
    }

    if (dto.paystackPublicKey !== undefined) {
      const key = dto.paystackPublicKey.trim() || null;
      data.paystackPublicKey = key;
      before.paystackPublicKey = tenant.paystackPublicKey;
      after.paystackPublicKey = key;
      persisted.push('paystackPublicKey');
    }

    if (dto.paystackSecretKey) {
      const secret = dto.paystackSecretKey.trim();
      data.paystackSecretKeyEnc = encryptSecret(secret);
      data.paystackSecretLast4 = secret.slice(-4);
      // Never put the secret (or ciphertext) in the audit trail.
      before.paystackSecretLast4 = tenant.paystackSecretLast4;
      after.paystackSecretLast4 = secret.slice(-4);
      persisted.push('paystackSecretKey');
    }

    if ((dto as any).paymentProvider !== undefined) {
      const raw = String((dto as any).paymentProvider).trim().toUpperCase();
      const allowed = ['PAYSTACK', 'FLUTTERWAVE', 'OTHER', 'BANK_TRANSFER', 'MONNIFY', 'REMITA'];
      const next = allowed.includes(raw) ? raw : raw || 'PAYSTACK';
      data.paymentProvider = next;
      before.paymentProvider = (tenant as any).paymentProvider;
      after.paymentProvider = next;
      persisted.push('paymentProvider');
    }

    if ((dto as any).flutterwaveEnabled !== undefined) {
      data.flutterwaveEnabled = (dto as any).flutterwaveEnabled;
      before.flutterwaveEnabled = (tenant as any).flutterwaveEnabled;
      after.flutterwaveEnabled = (dto as any).flutterwaveEnabled;
      persisted.push('flutterwaveEnabled');
    }
    if ((dto as any).flutterwavePublicKey !== undefined) {
      const key = String((dto as any).flutterwavePublicKey).trim() || null;
      data.flutterwavePublicKey = key;
      before.flutterwavePublicKey = (tenant as any).flutterwavePublicKey;
      after.flutterwavePublicKey = key;
      persisted.push('flutterwavePublicKey');
    }
    if ((dto as any).flutterwaveSecretKey) {
      const secret = String((dto as any).flutterwaveSecretKey).trim();
      data.flutterwaveSecretKeyEnc = encryptSecret(secret);
      data.flutterwaveSecretLast4 = secret.slice(-4);
      before.flutterwaveSecretLast4 = (tenant as any).flutterwaveSecretLast4;
      after.flutterwaveSecretLast4 = secret.slice(-4);
      persisted.push('flutterwaveSecretKey');
    }
    if ((dto as any).flutterwaveWebhookSecret) {
      const secret = String((dto as any).flutterwaveWebhookSecret).trim();
      data.flutterwaveWebhookSecretEnc = encryptSecret(secret);
      before.flutterwaveWebhookSecretEnc = (tenant as any).flutterwaveWebhookSecretEnc ? '[REDACTED]' : null;
      after.flutterwaveWebhookSecretEnc = '[REDACTED]';
      persisted.push('flutterwaveWebhookSecret');
    }

    if (dto.smtpEnabled !== undefined) {
      data.smtpEnabled = dto.smtpEnabled;
      before.smtpEnabled = tenant.smtpEnabled;
      after.smtpEnabled = dto.smtpEnabled;
      persisted.push('smtpEnabled');
    }
    if (dto.smtpHost !== undefined) {
      data.smtpHost = dto.smtpHost.trim() || null;
      before.smtpHost = tenant.smtpHost;
      after.smtpHost = data.smtpHost;
      persisted.push('smtpHost');
    }
    if (dto.smtpPort !== undefined) {
      data.smtpPort = dto.smtpPort;
      before.smtpPort = tenant.smtpPort;
      after.smtpPort = dto.smtpPort;
      persisted.push('smtpPort');
    }
    if (dto.smtpUser !== undefined) {
      data.smtpUser = dto.smtpUser.trim() || null;
      before.smtpUser = tenant.smtpUser;
      after.smtpUser = data.smtpUser;
      persisted.push('smtpUser');
    }
    if (dto.smtpPass) {
      const pass = dto.smtpPass.trim();
      data.smtpPassEnc = encryptSecret(pass);
      data.smtpPassLast4 = pass.slice(-4);
      before.smtpPassLast4 = tenant.smtpPassLast4;
      after.smtpPassLast4 = pass.slice(-4);
      persisted.push('smtpPass');
    }
    if (dto.smtpFromEmail !== undefined) {
      data.smtpFromEmail = dto.smtpFromEmail.trim() || null;
      before.smtpFromEmail = tenant.smtpFromEmail;
      after.smtpFromEmail = data.smtpFromEmail;
      persisted.push('smtpFromEmail');
    }
    if (dto.smtpFromName !== undefined) {
      data.smtpFromName = dto.smtpFromName.trim() || null;
      before.smtpFromName = tenant.smtpFromName;
      after.smtpFromName = data.smtpFromName;
      persisted.push('smtpFromName');
    }
    if (dto.fiberInstallationFeeKobo !== undefined) {
      data.fiberInstallationFeeKobo = dto.fiberInstallationFeeKobo;
      before.fiberInstallationFeeKobo = (tenant as any).fiberInstallationFeeKobo;
      after.fiberInstallationFeeKobo = dto.fiberInstallationFeeKobo;
      persisted.push('fiberInstallationFeeKobo');
    }
    if (dto.radioInstallationFeeKobo !== undefined) {
      data.radioInstallationFeeKobo = dto.radioInstallationFeeKobo;
      before.radioInstallationFeeKobo = (tenant as any).radioInstallationFeeKobo;
      after.radioInstallationFeeKobo = dto.radioInstallationFeeKobo;
      persisted.push('radioInstallationFeeKobo');
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.tenant?.update({ where: { id: tenant.id }, data });
      await this.audit.log({
        action: 'TENANT_SETTINGS_UPDATED',
        entityType: 'Tenant',
        entityId: tenant.id,
        beforeData: before,
        afterData: after,
      });
    }

    for (const key of PENDING_TENANT_FIELDS) {
      if (dto[key] !== undefined) pending.push(key);
    }

    if (pending.length) {
      this.logger.warn(
        `Tenant settings: ${pending.join(', ')} not persisted — no Tenant columns yet (schema pending). Values discarded for now.`,
      );
    }

    return {
      persisted,
      pending,
      message: pending.length
        ? `Saved ${persisted.length ? persisted.join(', ') : 'nothing'}. Not persisted yet (schema pending): ${pending.join(', ')}.`
        : undefined,
    };
  }

  /** Public client config — any authenticated user (customers need the public key). */
  async publicConfig() {
    const tenant = await this.getTenant();
    const provider = (tenant as any).paymentProvider ?? 'PAYSTACK';
    return {
      paymentProvider: provider,
      paystackEnabled: tenant.paystackEnabled,
      paystackPublicKey: tenant.paystackPublicKey ?? null,
      flutterwaveEnabled: (tenant as any).flutterwaveEnabled ?? false,
      flutterwavePublicKey: (tenant as any).flutterwavePublicKey ?? null,
      // Backward compat: expose generic active key
      activeProvider: provider,
      activePublicKey: provider === 'FLUTTERWAVE' ? ((tenant as any).flutterwavePublicKey ?? null) : (tenant.paystackPublicKey ?? null),
    };
  }
}
