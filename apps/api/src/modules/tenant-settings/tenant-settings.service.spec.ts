import { Test } from '@nestjs/testing';
import { TenantSettingsService } from './tenant-settings.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-logs/audit.service';

describe('TenantSettingsService', () => {
  let service: TenantSettingsService;
  let prisma: { tenant: { findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock } };
  let audit: { log: jest.Mock };

  const tenant = { id: 'tenant-1', name: 'Default Tenant', slug: 'default', isActive: true };

  beforeEach(async () => {
    prisma = {
      tenant: {
        findFirst: jest.fn().mockResolvedValue(tenant),
        findUnique: jest.fn().mockResolvedValue(tenant),
        update: jest.fn().mockResolvedValue({ ...tenant, name: 'New Name' }),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantSettingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(TenantSettingsService);
  });

  it('returns the tenant with persisted and pending field lists', async () => {
    const result = await service.get();
    expect(result.name).toBe('Default Tenant');
    expect(result.slug).toBe('default');
    expect(result.persistedFields).toEqual(
      expect.arrayContaining(['name', 'paystackEnabled', 'paystackSecretKey', 'smtpEnabled', 'smtpPass']),
    );
    expect(result.pendingFields).toContain('logoUrl');
    expect(result.pendingFields).toContain('vatRate');
    expect(result.billing.vatRate).toBe(7.5);
  });

  it('persists the name and audits the before/after', async () => {
    const result = await service.update({ name: 'New Name' });
    expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 'tenant-1' }, data: { name: 'New Name' } });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TENANT_SETTINGS_UPDATED',
        entityType: 'Tenant',
        entityId: 'tenant-1',
        beforeData: { name: 'Default Tenant' },
        afterData: { name: 'New Name' },
      }),
    );
    expect(result.persisted).toEqual(['name']);
    expect(result.pending).toEqual([]);
  });

  it('does not write or audit when the name is unchanged', async () => {
    const result = await service.update({ name: 'Default Tenant' });
    expect(prisma.tenant.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(result.persisted).toEqual(['name']);
  });

  it('reports fields with no schema column as pending instead of dropping silently', async () => {
    const result = await service.update({ logoUrl: 'https://x/logo.png', vatRate: 7.5, invoicePrefix: 'INV' });
    expect(result.persisted).toEqual([]);
    expect(result.pending).toEqual(['logoUrl', 'vatRate', 'invoicePrefix']);
    expect(result.message).toContain('schema pending');
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('stores the Paystack secret encrypted and never audits the plaintext', async () => {
    const result = await service.update({ paystackEnabled: true, paystackPublicKey: 'pk_test_1', paystackSecretKey: 'sk_test_secret_123456' });
    expect(result.persisted).toEqual(['paystackEnabled', 'paystackPublicKey', 'paystackSecretKey']);
    const data = prisma.tenant.update.mock.calls[0][0].data;
    expect(data.paystackSecretKeyEnc).toMatch(/^v1:/);
    expect(data.paystackSecretKeyEnc).not.toContain('sk_test_secret_123456');
    expect(data.paystackSecretLast4).toBe('3456');
    const auditPayload = JSON.stringify(audit.log.mock.calls[0][0]);
    expect(auditPayload).not.toContain('sk_test_secret_123456');
  });

  it('stores the SMTP password encrypted and reports it masked on read', async () => {
    await service.update({ smtpEnabled: true, smtpHost: 'smtp-relay.brevo.com', smtpPort: 465, smtpUser: 'u@x.co', smtpPass: 'brevo-smtp-key-9876' });
    const data = prisma.tenant.update.mock.calls[0][0].data;
    expect(data.smtpPassEnc).toMatch(/^v1:/);
    expect(data.smtpPassEnc).not.toContain('brevo-smtp-key-9876');
    expect(data.smtpPort).toBe(465);

    prisma.tenant.findFirst.mockResolvedValue({
      ...tenant,
      smtpEnabled: true,
      smtpHost: 'smtp-relay.brevo.com',
      smtpPort: 465,
      smtpUser: 'u@x.co',
      smtpPassEnc: data.smtpPassEnc,
      smtpFromEmail: 'noreply@x.co',
    });
    prisma.tenant.findUnique.mockResolvedValue({
      ...tenant,
      smtpEnabled: true,
      smtpHost: 'smtp-relay.brevo.com',
      smtpPort: 465,
      smtpUser: 'u@x.co',
      smtpPassEnc: data.smtpPassEnc,
      smtpFromEmail: 'noreply@x.co',
    });
    const settings = await service.get();
    expect(settings.email.enabled).toBe(true);
    expect(settings.email.host).toBe('smtp-relay.brevo.com');
    expect(settings.email.passMasked).toContain('…');
    expect(JSON.stringify(settings)).not.toContain('brevo-smtp-key-9876');
  });
});
