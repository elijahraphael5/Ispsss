import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { AuditService } from '../audit-logs/audit.service';
import { MailService, LoginDetailsData } from '../mail/mail.service';

const userSelect = {
  id: true, email: true, name: true, phone: true, isSuperAdmin: true, twoFaEnabled: true, createdAt: true, updatedAt: true,
  customRoleId: true,
  customRole: { select: { id: true, name: true } },
};

export interface ImportRowResult {
  row: number;
  email: string;
  name: string;
  status: string;
  reason?: string;
  plan?: string;
}

export interface ImportJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  stage: string;
  total: number;
  processed: number;
  created: number;
  skipped: number;
  errors: number;
  rows: ImportRowResult[];
  error?: string;
}

export interface LaunchJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  stage: string;
  total: number;
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  skippedList: { email: string; reason: string }[];
  failedList: { email: string; error: string }[];
  error?: string;
}

const planSelect = { id: true, name: true, technology: true, category: true, speedMbps: true, speedLabel: true, priceKobo: true };

const customerInclude: Prisma.SubscriberInclude = {
  user: { select: { id: true, name: true, email: true, phone: true, secondaryPhone: true } },
  subscriptions: {
    include: { plan: { select: planSelect } },
    orderBy: { startedAt: 'desc' },
    take: 1,
  },
  invoices: {
    where: { status: { in: ['ISSUED', 'OVERDUE'] } },
    orderBy: { dueAt: 'asc' },
    take: 1,
  },
  devices: true,
};

// ── PHPRadius → Hikonnect Import Helpers (spec §1-9) ──────────────────
function isPhpRadiusSheet(headers: string[]): boolean {
  const m = headers.map(h => String(h ?? '').trim().toUpperCase());
  return m.includes('USER TYPE') && m.includes('IP ADDRESS') && m.includes('STATION');
}
function cleanPhoneSpec(raw: unknown): { primary: string | null; secondary: string | null } {
  const s = String(raw ?? '').trim();
  if (!s) return { primary: null, secondary: null };
  // split two numbers
  const parts = s.split(/[\/;,]+/).map(p => p.trim()).filter(Boolean);
  const cleanOne = (p: string): string | null => {
    let v = p.trim();
    if (!v) return null;
    // strip sign
    if (v.startsWith('-')) v = v.slice(1);
    // keep only digits
    v = v.replace(/\D/g, '');
    if (!v) return null;
    // missing leading 0 → prepend 0 if 10 digits (802... → 0802...)
    if (v.length === 10 && !v.startsWith('0')) v = '0' + v;
    // if still not 11 digits starting with 0, keep as is if at least 10
    return v || null;
  };
  const primary = cleanOne(parts[0] ?? '');
  const secondary = parts[1] ? cleanOne(parts[1]) : null;
  return { primary, secondary };
}
function cleanIpSpec(raw: unknown): { ip: string | null; needsFlag: boolean; note?: string } {
  let s = String(raw ?? '').trim();
  if (!s) return { ip: null, needsFlag: false };
  // 192,168.2.127 → dot
  s = s.replace(/,/g, '.').trim();
  // remove spaces
  s = s.replace(/\s+/g, '');
  // flag malformed first octet
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}|x)$/i);
  if (!m) return { ip: s || null, needsFlag: false };
  const octets = [m[1], m[2], m[3], m[4]];
  let flagged = false;
  let note: string | undefined;
  // 198.168.x.x → likely typo 198→192
  if (octets[0] === '198' && octets[1] === '168') {
    flagged = true;
    note = `first octet 198→192 typo? kept as ${s} flagged`;
    // keep as-is but flag, don't silently guess — spec says flag either way
    // we keep original s, but also provide cleaned version for reference
  }
  if (octets[0] === '192' && octets[1] === '146') {
    flagged = true;
    note = `192.146.x.x non-standard flagged`;
  }
  if (octets[3].toLowerCase() === 'x') {
    // incomplete like 192.168.2.x → keep as is flagged
    flagged = true;
    note = note ? note + ' + incomplete .x' : 'incomplete .x';
  }
  // basic octet range check
  for (let i = 0; i < 3; i++) {
    const n = parseInt(octets[i], 10);
    if (Number.isNaN(n) || n < 0 || n > 255) flagged = true;
  }
  return { ip: s, needsFlag: flagged, note };
}
function parseExpirySpec(raw: unknown): { date: Date | null; flagged: boolean } {
  if (raw == null || raw === '') return { date: null, flagged: false };
  // handle Excel serial or Date object
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) return { date: new Date(Date.UTC(d.y, d.m - 1, d.d)), flagged: false };
    return { date: null, flagged: false };
  }
  let s = String(raw).trim();
  if (!s) return { date: null, flagged: false };
  // strip stray dot: 13./08/2026 → 13/08/2026
  s = s.replace(/\.\//g, '/').replace(/\s*\.\s*/g, '').trim();
  // try DD/MM/YYYY
  const dm = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dm) {
    let d = parseInt(dm[1], 10), mo = parseInt(dm[2], 10) - 1, y = parseInt(dm[3], 10);
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, mo, d));
    if (!isNaN(dt.getTime())) {
      // normalize stale before 2026-09-15 → 2026-09-30
      const cutoff = Date.UTC(2026, 8, 15);
      const endOfMonth = new Date(Date.UTC(2026, 8, 30));
      if (dt.getTime() < cutoff) return { date: endOfMonth, flagged: true };
      return { date: dt, flagged: false };
    }
  }
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    const cutoff = Date.UTC(2026, 8, 15);
    const endOfMonth = new Date(Date.UTC(2026, 8, 30));
    if (dt.getTime() < cutoff) return { date: endOfMonth, flagged: true };
    return { date: dt, flagged: false };
  }
  return { date: null, flagged: false };
}
function formatZoneLabelSpec(slug: string): string { return slug.replace(/_/g,' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()); }

function toCustomerView(sub: any) {
  const plan = sub.subscriptions?.[0]?.plan ?? null;
  const due = sub.invoices?.[0] ?? null;
  const email: string | null = sub.user?.email ?? null;
  const address: string | null = sub.address ?? null;
  return {
    id: sub.id,
    userId: sub.userId,
    name: sub.user?.name ?? null,
    email: email && !email.endsWith('@lan') ? email : null,
    phone: sub.user?.phone ?? null,
    secondaryPhone: (sub.user as any)?.secondaryPhone ?? null,
    pppoeUsername: sub.pppoeUsername ?? null,
    address: address && !address.startsWith('Static IP:') ? address : null,
    status: sub.status,
    type: sub.type,
    networkType: sub.networkType ?? plan?.technology ?? null,
    staticIpAddress: (sub as any).staticIpAddress ?? null,
    stationLabel: (sub as any).stationLabel ?? null,
    legacyId: (sub as any).legacyId ?? null,
    hikonnectId: (sub as any).hikonnectId ?? null,
    companyName: (sub as any).companyName ?? null,
    id2: (sub as any).id2 ?? null,
    firstName: (sub as any).firstName ?? null,
    lastName: (sub as any).lastName ?? null,
    plan: plan?.name ?? null,
    planCategory: plan?.category ?? null,
    speedMbps: plan?.speedMbps ?? null,
    speedLabel: plan?.speedLabel ?? null,
    priceKobo: plan?.priceKobo ?? null,
    startedAt: sub.subscriptions?.[0]?.startedAt ?? null,
    expiresAt: sub.subscriptions?.[0]?.expiresAt ?? null,
    dueAt: due?.dueAt ?? null,
    dueAmountKobo: due?.amountKobo ?? null,
    dueStatus: due?.status ?? null,
    cpes: (sub.devices ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      ipAddress: c.ipAddress,
      macAddress: c.macAddress,
      needsMacAddress: (c as any).needsMacAddress ?? false,
      ipConflict: (c as any).ipConflict ?? false,
      status: c.status,
      connectionType: c.connectionType,
      installerName: c.installerName,
      lastSeenAt: c.lastSeenAt,
    })),
    createdAt: sub.createdAt,
  };
}

@Injectable()
export class UsersService {
  async findAll(pagination?: { skip?: number; take?: number }) {
    const take = Math.min(Math.max(pagination?.take ?? 50, 1), 1000);
    const skip = Math.max(pagination?.skip ?? 0, 0);
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      select: userSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async findOne(id: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id, deletedAt: null },
      select: userSelect,
    });
  }

  /**
   * `User.phone` is unique across ALL rows — soft-deleted ones included, since
   * the DB index ignores `deletedAt`. A stale row's phone is released so the
   * new account can claim it; a live duplicate gets a 409 instead of the
   * Prisma unique-constraint 500.
   *
   * Stale holders that are auto-released:
   * - Soft-deleted User (deletedAt != null)
   * - User whose email was moved to `deleted-<id>@local` by a customer delete
   * - User whose Subscriber is soft-deleted (customer deleted but User not soft-deleted)
   */
  private async assertPhoneAvailable(phone: string, excludeUserId?: string): Promise<void> {
    const rows: Array<{ id: string; deletedAt: Date | null; email: string; subDeletedAt: Date | null }> = excludeUserId
      ? await this.prisma.$queryRaw`
          SELECT u.id, u."deletedAt", u.email, s."deletedAt" as "subDeletedAt"
          FROM "User" u LEFT JOIN "Subscriber" s ON s."userId" = u.id
          WHERE u.phone = ${phone} AND u.id <> ${excludeUserId} LIMIT 1`
      : await this.prisma.$queryRaw`
          SELECT u.id, u."deletedAt", u.email, s."deletedAt" as "subDeletedAt"
          FROM "User" u LEFT JOIN "Subscriber" s ON s."userId" = u.id
          WHERE u.phone = ${phone} LIMIT 1`;
    const owner = rows[0];
    if (!owner) return;
    const isPlaceholderEmail = owner.email?.startsWith('deleted-') && owner.email?.endsWith('@local');
    const isOrphanedCustomer = !!owner.subDeletedAt;
    // Live active owner — phone is truly taken
    if (!owner.deletedAt && !isPlaceholderEmail && !isOrphanedCustomer) {
      throw new ConflictException('A user with this phone number already exists');
    }
    // Stale holder — release phone and secondaryPhone so new account can claim it
    await this.prisma.$queryRaw`UPDATE "User" SET phone = NULL, "secondaryPhone" = NULL WHERE id = ${owner.id}`;
  }

  async create(data: { email: string; password: string; phone?: string; secondaryPhone?: string; name?: string; customRoleId?: string }, actorId: string) {
    const email = data.email.trim().toLowerCase();
    const phone = data.phone?.trim() || null;
    const secondaryPhone = (data.secondaryPhone ?? '').trim() || null;
    // Soft-deleted rows are invisible to the soft-delete extension, so check
    // the raw table: an ACTIVE customer keeps their email, anything stale
    // (soft-deleted user or orphan left by a customer deletion) releases it.
    const rows: Array<{ id: string; deletedAt: Date | null; hasSubscriber: boolean }> = await this.prisma.$queryRaw`
      SELECT u.id, u."deletedAt",
        EXISTS(SELECT 1 FROM "Subscriber" s WHERE s."userId" = u.id AND s."deletedAt" IS NULL) AS "hasSubscriber"
      FROM "User" u WHERE u.email = ${email} LIMIT 1
    `;
    const existing = rows[0];
    if (existing && !existing.deletedAt && existing.hasSubscriber) {
      throw new ConflictException('A user with this email already exists');
    }
    if (phone) await this.assertPhoneAvailable(phone);
    if (existing) {
      // Never reuse deleted data: move the stale row's email to an id-based
      // placeholder so the address belongs to a brand-new account only.
      await this.prisma.$queryRaw`UPDATE "User" SET email = 'deleted-' || id || '@local' WHERE id = ${existing.id}`;
    }
    // CONTACT NUMBER secondary — clean via same spec as import
    let secondaryPhoneClean: string | null = null;
    if (secondaryPhone) {
      const cleaned = secondaryPhone.replace(/\D/g, '');
      const v = cleaned.length === 10 && !cleaned.startsWith('0') ? '0' + cleaned : cleaned;
      secondaryPhoneClean = v || null;
    }
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(data.password, 12);
    const tenant = await this.prisma.tenant?.findFirst();
    if (!tenant) throw new NotFoundException('Default tenant not found — seed the database');
    const tenantId = tenant.id;
    let result;
    try {
      result = await this.prisma.user.create({
        data: { tenantId, email, name: data.name, passwordHash, phone, secondaryPhone: secondaryPhoneClean, customRoleId: data.customRoleId },
        select: userSelect,
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('A user with this email or phone number already exists');
      throw e;
    }
    await this.audit.log({ actorId, action: 'USER_CREATED', entityType: 'User', entityId: result.id, afterData: { email, name: data.name, phone, customRoleId: data.customRoleId } as any, metadata: { email, customRoleId: data.customRoleId } });
    await this.invalidateCustomerCache();
    return result;
  }

  async update(id: string, data: { email?: string; name?: string; phone?: string; secondaryPhone?: string; customRoleId?: string; password?: string; isSuperAdmin?: boolean }, actorId: string) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true, name: true, phone: true, secondaryPhone: true, isSuperAdmin: true, customRoleId: true } });
    // Explicit field picking — never spread caller-supplied objects into
    // Prisma data (mass-assignment protection).
    const updateData: any = {};
    if (data.email !== undefined) updateData.email = data.email;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) {
      if (data.phone) await this.assertPhoneAvailable(data.phone, id);
      updateData.phone = data.phone;
    }
    if ((data as any).secondaryPhone !== undefined) updateData.secondaryPhone = (data as any).secondaryPhone || null;
    if (data.customRoleId !== undefined) updateData.customRoleId = data.customRoleId;
    if (data.isSuperAdmin !== undefined) updateData.isSuperAdmin = data.isSuperAdmin;
    if (data.password) {
      const bcrypt = await import('bcryptjs');
      updateData.passwordHash = await bcrypt.hash(data.password, 12);
    }
    let result;
    try {
      result = await this.prisma.user.update({
        where: { id },
        data: updateData,
        select: userSelect,
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('A user with this email or phone number already exists');
      throw e;
    }
    await this.audit.log({ actorId, action: 'USER_UPDATED', entityType: 'User', entityId: id, beforeData: before as any, afterData: { email: result.email, name: result.name, phone: result.phone, isSuperAdmin: result.isSuperAdmin, customRoleId: result.customRoleId } as any, metadata: { changes: Object.keys(updateData) } });
    await this.invalidateCustomerCache();
    return result;
  }

  async customers(pagination?: { skip?: number; take?: number }) {
    const take = Math.min(Math.max(pagination?.take ?? 50, 1), 1000);
    const skip = Math.max(pagination?.skip ?? 0, 0);
    const tenantId = (await this.prisma.tenant?.findFirst())?.id;
    const cacheKey = `users:customers:${tenantId}:${skip}:${take}`;
    const cached = await this.cache.get<any[]>(cacheKey);
    if (cached) return cached;
    // Accounts awaiting KYC approval (maker–checker) stay out of the customer
    // table until a checker approves them.
    const subs = await this.prisma.subscriber.findMany({
      where: { tenantId, deletedAt: null, status: { not: 'PENDING_KYC' } },
      include: customerInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    const result = subs.map(toCustomerView);
    // Short TTL: read on every admin page load; mutations invalidate explicitly.
    await this.cache.set(cacheKey, result, 30);
    return result;
  }

  /** Drop cached user/customer reads after any mutation that affects them. */
  private async invalidateCustomerCache(): Promise<void> {
    await this.cache.invalidatePattern('users:*');
  }

  async kycQueue(pagination?: { skip?: number; take?: number }) {
    const take = Math.min(Math.max(pagination?.take ?? 50, 1), 1000);
    const skip = Math.max(pagination?.skip ?? 0, 0);
    const tenantId = (await this.prisma.tenant?.findFirst())?.id;
    const cacheKey = `users:kyc:${tenantId}:${skip}:${take}`;
    const cached = await this.cache.get<any[]>(cacheKey);
    if (cached) return cached;
    const subs = await this.prisma.subscriber.findMany({
      where: { tenantId, deletedAt: null, status: 'PENDING_KYC' },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, secondaryPhone: true } },
        subscriptions: {
          include: { plan: { select: planSelect } },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
        devices: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    const staffIds = [...new Set(
      subs.flatMap(s => [s.kycSubmittedById, s.kycApprovedById, s.kycRejectedById].filter((v): v is string => !!v)))];
    const staff = staffIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true, email: true } })
      : [];
    const staffMap = new Map(staff.map(u => [u.id, u]));
    const result = subs.map(s => {
      const plan = s.subscriptions?.[0]?.plan ?? null;
      const sub = s.subscriptions?.[0] ?? null;
      const email: string | null = s.user?.email ?? null;
      const maker = s.kycSubmittedById ? staffMap.get(s.kycSubmittedById) : null;
      const cpe = (s.devices ?? [])[0] as any;
      return {
        id: s.id,
        userId: s.userId,
        name: s.user?.name ?? null,
        email: email && !email.endsWith('@lan') ? email : null,
        phone: s.user?.phone ?? null,
        secondaryPhone: (s.user as any)?.secondaryPhone ?? null,
        address: s.address ?? null,
        pppoeUsername: s.pppoeUsername ?? null,
        networkType: s.networkType ?? plan?.technology ?? null,
        type: s.type,
        plan: plan?.name ?? null,
        speedMbps: plan?.speedMbps ?? null,
        priceKobo: plan?.priceKobo ?? null,
        // Full create-form capture for KYC review
        legacyId: (s as any).legacyId ?? null,
        hikonnectId: (s as any).hikonnectId ?? null,
        id2: (s as any).id2 ?? null,
        firstName: (s as any).firstName ?? null,
        lastName: (s as any).lastName ?? null,
        companyName: (s as any).companyName ?? null,
        stationLabel: (s as any).stationLabel ?? null,
        staticIpAddress: (s as any).staticIpAddress ?? cpe?.ipAddress ?? null,
        ipAddress: cpe?.ipAddress ?? (s as any).staticIpAddress ?? null,
        // Billing / dates from subscription
        startedAt: sub?.startedAt ?? null,
        expiresAt: sub?.expiresAt ?? null,
        installationFeeKobo: (sub as any)?.installationFeeKobo ?? null,
        planId: plan?.id ?? null,
        status: s.status,
        kycVerified: s.kycVerified,
        kycSubmittedById: s.kycSubmittedById,
        kycSubmittedAt: s.kycSubmittedAt,
        kycSubmittedByName: maker?.name ?? maker?.email ?? null,
        kycApprovedById: s.kycApprovedById,
        kycApprovedAt: s.kycApprovedAt,
        kycRejectedById: s.kycRejectedById,
        kycRejectedAt: s.kycRejectedAt,
        kycRejectReason: s.kycRejectReason,
        cpeCount: (s.devices ?? []).length,
        createdAt: s.createdAt,
      };
    });
    await this.cache.set(cacheKey, result, 15);
    return result;
  }

  async approveKyc(id: string, actor: { id: string; isSuperAdmin?: boolean; customRole?: { name: string } | null }) {
    const actorId = actor.id;
    const sub = await this.prisma.subscriber.findUniqueOrThrow({
      where: { id, deletedAt: null },
      select: { id: true, status: true, userId: true, kycSubmittedById: true },
    });
    // Maker–checker separation: the admin who created the account may not be
    // the one who approves it — EXCEPT the platform admin role (SUPER_ADMIN or
    // isSuperAdmin), which may create AND approve.
    const canSelfApprove = actor.isSuperAdmin === true || actor.customRole?.name === 'SUPER_ADMIN';
    if (!canSelfApprove && sub.kycSubmittedById && sub.kycSubmittedById === actorId) {
      throw new BadRequestException('Maker–checker: the admin who created this account cannot approve it. Another admin must approve.');
    }
    const updated = await this.prisma.subscriber.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        kycVerified: true,
        kycApprovedById: actorId,
        kycApprovedAt: new Date(),
        kycRejectedById: null,
        kycRejectedAt: null,
        kycRejectReason: null,
      },
      select: { id: true, status: true, kycVerified: true, kycApprovedAt: true },
    });
    await this.audit.log({ actorId, action: 'KYC_APPROVED', entityType: 'Subscriber', entityId: id, beforeData: { status: sub.status } as any, afterData: { status: 'ACTIVE', kycVerified: true } as any, metadata: { userId: sub.userId } });
    await this.invalidateCustomerCache();
    return updated;
  }

  async rejectKyc(id: string, actorId: string, reason?: string) {
    const sub = await this.prisma.subscriber.findUniqueOrThrow({
      where: { id, deletedAt: null },
      select: { id: true, status: true, userId: true },
    });
    const updated = await this.prisma.subscriber.update({
      where: { id },
      data: {
        kycRejectedById: actorId,
        kycRejectedAt: new Date(),
        kycRejectReason: reason?.trim() || null,
      },
      select: { id: true, status: true, kycVerified: true, kycRejectedAt: true },
    });
    await this.audit.log({ actorId, action: 'KYC_REJECTED', entityType: 'Subscriber', entityId: id, beforeData: { status: sub.status } as any, afterData: { kycRejectReason: reason?.trim() || null } as any, metadata: { userId: sub.userId } });
    await this.invalidateCustomerCache();
    return updated;
  }

  private genPassword(): string {
    return 'Hk-' + crypto.randomBytes(5).toString('hex');
  }

  private readonly launchJobs = new Map<string, LaunchJob>();
  private readonly importJobs = new Map<string, ImportJob>();
  private static jobsSweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly cache: CacheService) {
    // Periodically purge finished background jobs so the in-memory maps
    // can't grow unbounded across a long-lived process.
    if (!UsersService.jobsSweeper) {
      UsersService.jobsSweeper = setInterval(() => {
        for (const [id, j] of this.launchJobs) if (j.status !== 'running') this.launchJobs.delete(id);
        for (const [id, j] of this.importJobs) if (j.status !== 'running') this.importJobs.delete(id);
      }, 30 * 60 * 1000);
      UsersService.jobsSweeper.unref?.();
    }
  }

  async launchLogins(body: { testEmail?: string }, actorId: string) {
    const tenantId = (await this.prisma.tenant?.findFirst())?.id;
    const users = await this.prisma.user.findMany({
      where: { tenantId, deletedAt: null, subscriber: { isNot: null } },
      include: {
        subscriber: {
          include: {
            subscriptions: { include: { plan: { select: planSelect } }, orderBy: { startedAt: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const rawPortalUrl = this.config.get<string>('CUSTOMER_URL', 'http://localhost:3001');
    const portalUrl = /localhost|127\.0\.0\.1/.test(rawPortalUrl) ? 'https://my.hikonnectng.com' : rawPortalUrl;

    const buildData = (u: any, password: string): LoginDetailsData => {
      const sub = u.subscriber;
      const plan = sub?.subscriptions?.[0]?.plan;
      return {
        email: u.email,
        username: sub?.pppoeUsername ?? null,
        password,
        customerId: sub?.id.slice(0, 8).toUpperCase() ?? u.id.slice(0, 8).toUpperCase(),
        planName: plan?.name ?? undefined,
        portalUrl,
      };
    };

    if (body.testEmail) {
      // Dry run: send a preview to ANY address. Never look up or modify the
      // recipient's account — the password in the email is a throwaway sample
      // and is not saved anywhere. Works even when there are no customers yet.
      const password = this.genPassword();
      const sample = users[0];
      const data: LoginDetailsData = sample
        ? buildData(sample, password)
        : {
            email: body.testEmail,
            username: 'demo-pppoe',
            password,
            customerId: 'DEMO0001',
            planName: 'SAMPLE PLAN',
            portalUrl,
          };
      const sent = await this.mail.sendLoginDetails({ ...data, email: body.testEmail });
      return {
        mode: 'test',
        sentTo: body.testEmail,
        sample: { email: data.email, username: data.username, customerId: data.customerId, planName: data.planName },
        note: sent
          ? 'Preview only — the password in this email is a sample and will not work; no account was changed.'
          : 'Email could not be delivered (SMTP) — no account was changed.',
      };
    }

    const jobId = crypto.randomUUID();
    const job: LaunchJob = {
      id: jobId, status: 'running', stage: 'starting', total: users.length,
      processed: 0, sent: 0, skipped: 0, failed: 0, skippedList: [], failedList: [],
    };
    this.launchJobs.set(jobId, job);
    this.runLaunchJob(users, job, actorId).catch((e: Error) => {
      job.status = 'failed';
      job.error = e?.message?.slice(0, 300) ?? 'Launch failed';
    });
    return { jobId, status: 'running', total: users.length };
  }

  launchStatus(jobId: string): LaunchJob {
    const job = this.launchJobs.get(jobId);
    if (!job) throw new NotFoundException('Launch job not found');
    return job;
  }

  private async runLaunchJob(users: any[], job: LaunchJob, actorId: string) {
    const skipped: { email: string; reason: string }[] = [];
    const failed: { email: string; error: string }[] = [];
    const rawPortal = this.config.get<string>('CUSTOMER_URL', 'http://localhost:3001');
    const portalUrl = /localhost|127\.0\.0\.1/.test(rawPortal) ? 'https://my.hikonnectng.com' : rawPortal;

    const batches: any[][] = [];
    for (let i = 0; i < users.length; i += 10) batches.push(users.slice(i, i + 10));

    for (const batch of batches) {
      await Promise.all(batch.map(async (u) => {
        if (!u.email || u.email.endsWith('@local')) {
          skipped.push({ email: u.email ?? '—', reason: 'no real email address' });
          return;
        }
        try {
          const data = {
            email: u.email,
            username: u.subscriber?.pppoeUsername ?? null,
            password: this.genPassword(),
            customerId: u.subscriber?.id.slice(0, 8).toUpperCase() ?? u.id.slice(0, 8).toUpperCase(),
            planName: u.subscriber?.subscriptions?.[0]?.plan?.name ?? undefined,
            portalUrl,
          };
          // Send FIRST, and only rotate the stored password when the mail was
          // actually accepted by SMTP. Rotating before a confirmed send would
          // lock the customer out while reporting success.
          const sent = await this.mail.sendLoginDetails(data);
          if (!sent) {
            failed.push({ email: u.email, error: 'email not delivered (SMTP) — password NOT rotated' });
            job.failed++;
            job.processed++;
            return;
          }
          const bcrypt = await import('bcryptjs');
          const passwordHash = await bcrypt.hash(data.password, 12);
          await this.prisma.user.update({ where: { id: u.id }, data: { passwordHash } });
          job.sent++;
        } catch (e: any) {
          failed.push({ email: u.email, error: e?.message ?? 'unknown' });
          job.failed++;
        }
        job.processed++;
      }));
      job.stage = `processing ${Math.min(job.processed, users.length)} of ${users.length}`;
    }

    job.skipped = skipped.length;
    job.skippedList = skipped.slice(0, 20);
    job.failedList = failed.slice(0, 20);

    await this.audit.log({
      actorId,
      action: 'LAUNCH_CUSTOMER_LOGINS',
      entityType: 'User',
      entityId: 'bulk',
      metadata: { sent: job.sent, skipped: skipped.length, failed: failed.length },
    });

    job.status = 'done';
  }

  async customerDetail(id: string) {
    const cacheKey = `users:customer:${id}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;
    const sub = await this.prisma.subscriber.findUniqueOrThrow({
      where: { id, deletedAt: null },
      include: customerInclude,
    });
    const view = toCustomerView(sub);
    await this.cache.set(cacheKey, view, 30);
    return view;
  }

  async updateCustomer(id: string, data: { name?: string; email?: string; phone?: string; secondaryPhone?: string; address?: string; installerName?: string; networkType?: string; pppoeUsername?: string; planName?: string; dueAt?: string; ipAddress?: string; staticIpAddress?: string; legacyId?: string; id2?: string; firstName?: string; lastName?: string; companyName?: string; stationLabel?: string; startedAt?: string; expiresAt?: string; installationFee?: string; installationFeeKobo?: number }, actorId: string) {
    const sub = await this.prisma.subscriber.findUniqueOrThrow({ where: { id, deletedAt: null }, include: { user: true } });
    if (data.email !== undefined) {
      const normalized = data.email.trim().toLowerCase();
      if (!normalized) throw new BadRequestException('Email cannot be empty — the customer needs it to sign in');
      const taken = await this.prisma.user.findFirst({
        where: { email: normalized, id: { not: sub.userId }, deletedAt: null },
        select: { id: true },
      });
      if (taken) throw new ConflictException('A user with this email already exists');
      data.email = normalized;
    }
    if (data.phone) await this.assertPhoneAvailable(data.phone, sub.userId);
    if (data.email !== undefined || data.phone !== undefined || data.name !== undefined || (data as any).secondaryPhone !== undefined) {
      await this.prisma.user.update({
        where: { id: sub.userId },
        data: {
          ...(data.name !== undefined ? { name: data.name || null } : {}),
          ...(data.email !== undefined ? { email: data.email } : {}),
          ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
          ...((data as any).secondaryPhone !== undefined ? { secondaryPhone: (data as any).secondaryPhone || null } : {}),
        },
      });
    }
    if (data.address !== undefined || data.networkType !== undefined || data.pppoeUsername !== undefined || data.legacyId !== undefined || data.id2 !== undefined || data.firstName !== undefined || data.lastName !== undefined || data.companyName !== undefined || data.stationLabel !== undefined) {
      // Enforce unique Legacy ID (HIF/HIR) — free stale soft-deleted holders
      if (data.legacyId !== undefined) {
        const trimmed = data.legacyId?.trim() || '';
        if (trimmed) {
          const rows: Array<{ id: string; deletedAt: Date | null }> = await this.prisma.$queryRaw`SELECT id, "deletedAt" FROM "Subscriber" WHERE "legacyId" = ${trimmed} AND id <> ${id} LIMIT 1`;
          const owner = rows[0];
          if (owner) {
            if (!owner.deletedAt) throw new ConflictException(`Legacy ID ${trimmed} is already in use`);
            await this.prisma.$queryRaw`UPDATE "Subscriber" SET "legacyId" = NULL WHERE id = ${owner.id}`;
          }
          data.legacyId = trimmed;
        } else {
          (data as any).legacyId = null;
        }
      }
      try {
        await this.prisma.subscriber.update({
          where: { id },
          data: {
            ...(data.address !== undefined ? { address: data.address || null } : {}),
            ...(data.networkType !== undefined ? { networkType: data.networkType || null } : {}),
            ...(data.pppoeUsername !== undefined ? { pppoeUsername: data.pppoeUsername.trim() || null } : {}),
            ...(data.legacyId !== undefined ? { legacyId: (data as any).legacyId } : {}),
            ...(data.id2 !== undefined ? { id2: data.id2?.trim() || null } : {}),
            ...(data.firstName !== undefined ? { firstName: data.firstName?.trim() || null } : {}),
            ...(data.lastName !== undefined ? { lastName: data.lastName?.trim() || null } : {}),
            ...(data.companyName !== undefined ? { companyName: data.companyName?.trim() || null } : {}),
            ...(data.stationLabel !== undefined ? { stationLabel: data.stationLabel?.trim() || null } : {}),
          } as any,
        });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          const target = String(e?.meta?.target ?? '');
          if (target.includes('legacyId')) throw new ConflictException('Legacy ID is already in use');
          throw new ConflictException('PPPoE username is already in use by another customer');
        }
        throw e;
      }
    }
    if (data.ipAddress !== undefined || data.staticIpAddress !== undefined) {
      const ip = (data.ipAddress ?? data.staticIpAddress ?? '').trim() || null;
      if (ip && !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) throw new BadRequestException('Invalid IP address');
      const currentCpe = await this.prisma.cpe.findFirst({ where: { subscriberId: id }, orderBy: { createdAt: 'asc' } });
      const currentIp = (sub as any).staticIpAddress ?? currentCpe?.ipAddress ?? null;
      if (ip !== currentIp) {
        try {
          await this.prisma.subscriber.update({ where: { id }, data: { staticIpAddress: ip } });
        } catch (e: any) {
          if (e?.code === 'P2002') throw new ConflictException('IP address is already in use');
          throw e;
        }
        const cpe = currentCpe ?? await this.prisma.cpe.findFirst({ where: { subscriberId: id }, orderBy: { createdAt: 'asc' } });
        if (ip) {
          if (cpe) {
            await this.prisma.cpe.update({ where: { id: cpe.id }, data: { ipAddress: ip, connectionType: 'STATIC_IP', status: 'OFFLINE', ipConflict: false } as any });
          } else {
            await this.prisma.cpe.create({ data: { subscriberId: id, ipAddress: ip, connectionType: 'STATIC_IP', status: 'OFFLINE', ipConflict: false, name: sub.pppoeUsername ?? (sub as any).hikonnectId ?? null } as any });
          }
        } else if (cpe) {
          await this.prisma.cpe.update({ where: { id: cpe.id }, data: { ipAddress: null, ipConflict: false } as any });
        }
      }
    }
    if (data.installerName !== undefined) {
      const updated = await this.prisma.cpe.updateMany({ where: { subscriberId: id }, data: { installerName: data.installerName || null } });
      // Imported PPPoE customers have no CPE row, so create one to hold the
      // installer (connectionType PPPOE is excluded from static-IP counts).
      if (updated.count === 0 && data.installerName) {
        await this.prisma.cpe.create({
          data: {
            subscriberId: id,
            name: sub.pppoeUsername ?? null,
            installerName: data.installerName,
            connectionType: 'PPPOE',
          },
        });
      }
    }
    if (data.planName !== undefined && data.planName) {
      const plan = await this.prisma.plan.findFirst({ where: { name: { equals: data.planName, mode: 'insensitive' } } });
      if (!plan) throw new NotFoundException(`Plan "${data.planName}" not found`);
      const latest = await this.prisma.subscription.findFirst({ where: { subscriberId: id }, orderBy: { startedAt: 'desc' } });
      if (latest) {
        await this.prisma.subscription.update({ where: { id: latest.id }, data: { planId: plan.id } });
      } else {
        await this.prisma.subscription.create({
          data: { subscriberId: id, planId: plan.id, startedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
        });
      }
    }
    if (data.dueAt !== undefined) {
      const due = new Date(data.dueAt);
      if (isNaN(due.getTime())) throw new BadRequestException('Invalid dueAt date');
      const unpaid = await this.prisma.invoice.findFirst({
        where: { subscriberId: id, status: { in: ['DRAFT', 'ISSUED', 'OVERDUE'] } },
        orderBy: { dueAt: 'asc' },
      });
      if (unpaid) {
        await this.prisma.invoice.update({ where: { id: unpaid.id }, data: { dueAt: due } });
      } else {
        const subWithPlan = await this.prisma.subscription.findFirst({ where: { subscriberId: id }, include: { plan: true }, orderBy: { startedAt: 'desc' } });
        if (subWithPlan) {
          const subtotal = subWithPlan.plan.priceKobo;
          const vat = Math.round(subtotal * 0.075);
          await this.prisma.invoice.create({
            data: {
              subscriberId: id,
              invoiceNumber: `INV-${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`,
              type: 'SUBSCRIPTION',
              status: 'ISSUED',
              subtotalKobo: subtotal,
              vatKobo: vat,
              amountKobo: subtotal + vat,
              dueAt: due,
              issuedAt: new Date(),
            },
          });
        }
      }
    }
    // Subscription dates & installation fee (from create-customer billing step) — update latest subscription
    if ((data as any).startedAt !== undefined || (data as any).expiresAt !== undefined || (data as any).installationFee !== undefined || (data as any).installationFeeKobo !== undefined) {
      const latest = await this.prisma.subscription.findFirst({ where: { subscriberId: id }, orderBy: { startedAt: 'desc' } });
      if (latest) {
        const upd: Record<string, unknown> = {};
        if ((data as any).startedAt !== undefined) {
          const d = new Date((data as any).startedAt);
          if (!isNaN(d.getTime())) upd.startedAt = d;
        }
        if ((data as any).expiresAt !== undefined) {
          const d = new Date((data as any).expiresAt);
          if (!isNaN(d.getTime())) upd.expiresAt = d;
        }
        if ((data as any).installationFee !== undefined) {
          const v = String((data as any).installationFee).trim();
          if (v === '') upd.installationFeeKobo = null;
          else {
            const kobo = Math.round(parseFloat(v) * 100);
            if (!isNaN(kobo)) upd.installationFeeKobo = kobo;
          }
        } else if ((data as any).installationFeeKobo !== undefined) {
          upd.installationFeeKobo = (data as any).installationFeeKobo;
        }
        if (Object.keys(upd).length) await this.prisma.subscription.update({ where: { id: latest.id }, data: upd as any });
      }
    }
    await this.audit.log({ actorId, action: 'USER_UPDATED', entityType: 'User', entityId: sub.userId, beforeData: { name: sub.user.name, email: sub.user.email, phone: sub.user.phone } as any, afterData: data as any, metadata: { changes: Object.keys(data) } });
    await this.invalidateCustomerCache();
    return this.customerDetail(id);
  }

  async remove(id: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { email: true, phone: true, customRoleId: true, isSuperAdmin: true } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    await this.audit.log({ actorId, action: 'USER_DELETED', entityType: 'User', entityId: id, beforeData: user as any, metadata: { email: user.email } });
    // Audit logs are immutable — they are intentionally NOT deleted here so
    // the trail of who did what survives the user's removal. The user row is
    // soft-deleted AND its unique email is released (moved to an id-based
    // placeholder) so the address can be registered as a brand-new account.
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.deleteMany({ where: { userId: id } });
      await tx.user.update({ where: { id }, data: { deletedAt: new Date(), email: `deleted-${id}@local`, phone: null, secondaryPhone: null } as any });
      return tx.user.findUnique({ where: { id }, select: userSelect });
    });
    await this.invalidateCustomerCache();
    return result;
  }

  // ── Excel import ────────────────────────────────────────────

  /**
   * Purges every customer from the platform (same wipe the Excel import runs
   * first). Staff users are preserved; the customer table ends up empty.
   */
  async purgeCustomers(actorId: string) {
    const removed = await this.prisma.subscriber.count({ where: { deletedAt: null } });
    await this.clearCustomerData();
    await this.audit.log({
      actorId,
      action: 'CUSTOMERS_PURGED',
      entityType: 'Subscriber',
      entityId: 'bulk-purge',
      metadata: { removedSubscribers: removed },
    });
    return { removedSubscribers: removed };
  }

  /**
   * Wipes ALL existing customer data (users with a subscriber, subscribers,
   * subscriptions, invoices/payments/receipts, quotations, chat/tickets,
   * plans, refresh tokens) so a re-upload of the list always starts clean.
   * Staff users (no subscriber) are preserved.
   */
  private async clearCustomerData() {    const tenantId = (await this.prisma.tenant?.findFirst())?.id;
    await this.prisma.$transaction(async (tx) => {
      // Tenant-scoped: never touch other tenants' plans/customers. Raw read so
      // soft-deleted subscribers (deleted customers) are included too — their
      // subscriptions still reference plans and would otherwise block the final
      // plan.deleteMany (Subscription_planId_fkey RESTRICT). The child deletes
      // below match by relation, so they clean soft-deleted rows as well.
      const subs: Array<{ id: string; userId: string }> = await tx.$queryRaw`
        SELECT id, "userId" FROM "Subscriber" WHERE "tenantId" = ${tenantId}
      `;
      const subIds = subs.map((s) => s.id);
      if (!subIds.length) {
        await tx.plan.deleteMany({ where: { tenantId } });
        return;
      }
      // Only users whose subscriber is part of this wipe — keeps the delete
      // tenant-scoped and avoids orphaning other tenants' data.
      const userIds = subs.map((s) => s.userId);
      // Match children through their parent relation instead of ID lists read
      // with the soft-delete extension: a soft-deleted invoice/payment/ticket/
      // session still holds a RESTRICT FK to its (active) subscriber, survives
      // the child deletes when looked up by id, and then blocks the final
      // subscriber delete.
      const subWhere = { subscriberId: { in: subIds } };
      // PaymentAttempt has no relation to Payment (plain string FK), so its
      // rows are cleaned via the payment ids.
      const paymentRows: Array<{ id: string }> = await tx.$queryRaw`
        SELECT p.id FROM "Payment" p JOIN "Invoice" i ON p."invoiceId" = i.id
        WHERE i."subscriberId" IN (${Prisma.join(subIds)})
      `;
      const paymentIds = paymentRows.map((p) => p.id);

      await tx.chatMessage.deleteMany({ where: { session: subWhere } });
      await tx.fileUpload.deleteMany({
        where: {
          OR: [
            { session: subWhere },
            { message: { session: subWhere } },
            { ticket: subWhere },
            { ticketComment: { ticket: subWhere } },
          ],
        },
      });
      // Tickets reference their source chat session (Ticket.sourceChatSessionId
      // FK) — delete tickets/comments before the sessions or the wipe fails.
      await tx.ticketComment.deleteMany({ where: { ticket: subWhere } });
      await tx.ticket.deleteMany({ where: subWhere });
      await tx.chatSession.deleteMany({ where: subWhere });
      await tx.refund.deleteMany({ where: { OR: [{ payment: { invoice: subWhere } }, { invoice: subWhere }] } });
      await tx.creditNote.deleteMany({ where: { invoice: subWhere } });
      await tx.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await tx.receipt.deleteMany({ where: { invoice: subWhere } });
      await tx.payment.deleteMany({ where: { invoice: subWhere } });
      await tx.invoiceLine.deleteMany({ where: { invoice: subWhere } });
      await tx.invoice.deleteMany({ where: subWhere });
      await tx.quotationItem.deleteMany({ where: { quotation: subWhere } });
      await tx.quotation.deleteMany({ where: subWhere });
      await tx.walletTransaction.deleteMany({ where: { wallet: { subscriberId: { in: subIds } } } });
      await tx.virtualAccount.deleteMany({ where: { subscriberId: { in: subIds } } });
      await tx.wallet.deleteMany({ where: { subscriberId: { in: subIds } } });
      await tx.notification.deleteMany({ where: { subscriberId: { in: subIds } } });
      await tx.pppoeSession.deleteMany({ where: { subscriberId: { in: subIds } } });
      await tx.contract.deleteMany({ where: { subscriberId: { in: subIds } } });
      // Use raw deletes for subscriptions/plans/subscribers to bypass soft-delete filter (hard delete must remove all, including soft-deleted)
      await tx.$executeRaw`DELETE FROM "Subscription" WHERE "subscriberId" IN (${Prisma.join(subIds)})`;
      await tx.$executeRaw`DELETE FROM "Cpe" WHERE "subscriberId" IN (${Prisma.join(subIds)})`;
      await tx.$executeRaw`DELETE FROM "Subscriber" WHERE id IN (${Prisma.join(subIds)})`;
      // Audit logs are immutable — preserved even when customer data is wiped.
      await tx.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await tx.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      // Every remaining FK to User must be cleared before the user rows go,
      // regardless of tenant/soft-delete scope (agent assignments, presence).
      await tx.ticket.updateMany({ where: { assignedAgentId: { in: userIds } }, data: { assignedAgentId: null } });
      await tx.chatSession.updateMany({ where: { agentId: { in: userIds } }, data: { agentId: null } });
      await tx.agentPresence.deleteMany({ where: { userId: { in: userIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
      await tx.$executeRaw`DELETE FROM "Plan" WHERE "tenantId" = ${tenantId}`;
    }, { timeout: 120_000, maxWait: 10_000 });
    await this.invalidateCustomerCache();
  }

  startImport(file: Express.Multer.File, actorId: string): { jobId: string } {
    if (!file) throw new BadRequestException('No file uploaded');
    const jobId = crypto.randomUUID();
    const job: ImportJob = {
      id: jobId, status: 'running', stage: 'reading file', total: 0, processed: 0,
      created: 0, skipped: 0, errors: 0, rows: [],
    };
    this.importJobs.set(jobId, job);
    this.importCustomers(file, actorId, job).catch((e: Error) => {
      job.status = 'failed';
      job.error = e?.message?.slice(0, 300) ?? 'Import failed';
    });
    return { jobId };
  }

  importStatus(jobId: string): ImportJob {
    const job = this.importJobs.get(jobId);
    if (!job) throw new NotFoundException('Import job not found');
    return job;
  }

  async importCustomers(file: Express.Multer.File, actorId: string, job: ImportJob) {
    if (!file) throw new BadRequestException('No file uploaded');
    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    // Prefer "PHP Radius" sheet per PHPRadius spec, otherwise first sheet; ignore Help/Sheet1 template
    let sheetName = wb.SheetNames[0];
    const phpIdx = wb.SheetNames.findIndex(n => String(n).trim().toLowerCase() === 'php radius');
    if (phpIdx >= 0) sheetName = wb.SheetNames[phpIdx];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) throw new BadRequestException('No sheet found in the file');
    const raw: Array<Record<string, unknown>> = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!raw.length) throw new BadRequestException('No data rows found in the file (first row must be headers)');
    const isPhpRadius = isPhpRadiusSheet(Object.keys(raw[0]));

    const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const headers = Object.keys(raw[0]);
    const findCol = (keys: string[]): string | null => {
      for (const h of headers) {
        const n = norm(h);
        if (!n) continue;
        if (keys.some(k => n === k || n.startsWith(k + ' ') || n.includes(k))) return h;
      }
      return null;
    };

    const firstNameCol = findCol(['first name', 'firstname', 'first']);
    const lastNameCol = findCol(['last name', 'lastname', 'last', 'surname']);
    const nameCol = firstNameCol && lastNameCol
      ? (findCol(['customer name', 'subscriber name', 'customer', 'subscriber']) ?? headers.find(h => norm(h) === 'name') ?? null)
      : findCol(['name', 'customer', 'subscriber']);
    const companyCol = findCol(['company name', 'company']);
    const emailCol = findCol(['email', 'mail']);
    const phoneCol = findCol(['contact number', 'contact', 'phone', 'mobile', 'telephone']);
    const addressCol = headers.find(h => {
      const n = norm(h);
      return n === 'address' || n === 'location' || n === 'street' || n.startsWith('address ') || n.startsWith('location ') || n.startsWith('street ');
    }) ?? null;
    const stationCol = findCol(['station']);
    const planCol = findCol(['plan', 'package', 'service']);
    const feeCol = findCol(['installation fee', 'fee', 'amount', 'price']);
    const dueCol = findCol(['due date', 'due', 'expiry', 'expires', 'valid until']);
    const portalPassCol = findCol(['portal password']);
    const radiusPassCol = findCol(['password']);
    const userTypeCol = findCol(['user type']);
    const ipAddressCol = findCol(['ip address', 'ip']);
    const idCol = headers.find(h => norm(h) === 'id');
    const id2Col = headers.find(h => norm(h) === 'id2');
    const usernameCol = idCol ?? id2Col;

    const toDate = (v: unknown): Date | null => {
      if (v == null || v === '') return null;
      if (typeof v === 'number') {
        const d = XLSX.SSF.parse_date_code(v);
        if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
        return null;
      }
      const s = String(v).trim();
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };

    const tenantId = (await this.prisma.tenant?.findFirst())?.id;

    job.stage = 'wiping existing customer data';
    await this.clearCustomerData();

    job.total = raw.length;
    job.stage = 'importing';

    const results: ImportRowResult[] = [];
    let created = 0, skipped = 0, errors = 0;
    const seenUsernames = new Set<string>();
    // PHPRadius spec counters and tracking (§1, §5)
    let fiberSeq = 1, radioSeq = 1;
    const seenIps = new Map<string, number>(); // for duplicate IP flag (§5)
    const seenLegacyIds = new Set<string>(); // for unique HIF/HIR enforcement
    const importDate = new Date();

    for (let i = 0; i < raw.length; i++) {
      job.processed = i + 1;
      const r = raw[i];
      const rowNo = i + 2;

      // ── PHPRadius branch (spec §1-9) ───────────────────────────────
      if (isPhpRadius) {
        const rawUserType = userTypeCol ? String(r[userTypeCol] ?? '').trim() : '';
        const userTypeNorm = rawUserType.toUpperCase().trim();
        // Filter to 566 valid rows: skip empty USER TYPE (470 blank rows in sheet)
        if (!userTypeNorm || (userTypeNorm !== 'RADIO' && !userTypeNorm.includes('FIBER'))) {
          // also skip truly empty rows
          const hasAny = [r[idCol ?? ''], r[emailCol ?? ''], r[phoneCol ?? ''], r[addressCol ?? ''], r[planCol ?? '']].some(v => String(v ?? '').trim());
          if (!hasAny) { skipped++; results.push({ row: rowNo, email: '', name: '', status: 'skipped', reason: 'empty row' }); continue; }
          // if USER TYPE is blank but row has content, skip as invalid per spec (only RADIO/FIBER valid)
          skipped++; results.push({ row: rowNo, email: String(r[emailCol ?? ''] ?? '').trim(), name: '', status: 'skipped', reason: `invalid USER TYPE "${rawUserType}"` }); continue;
        }
        const isRadio = userTypeNorm === 'RADIO';
        const isFiber = userTypeNorm.includes('FIBER');
        let legacyId: string | null = idCol ? (String(r[idCol] ?? '').trim() || null) : null;
        // Enforce unique HIF/HIR — auto-generate if empty or duplicate (HIF for Fiber, HIR for Radio)
        if (!legacyId || seenLegacyIds.has(legacyId.toUpperCase())) {
          const prefix = isRadio ? 'HIR-' : 'HIF-';
          // find next free number for this prefix within this import
          let n = 1;
          // start from current max seen +1 for efficiency
          const existingNums = Array.from(seenLegacyIds)
            .filter(v => v.startsWith(prefix))
            .map(v => parseInt(v.slice(prefix.length), 10))
            .filter(v => !isNaN(v));
          if (existingNums.length) n = Math.max(...existingNums) + 1;
          let candidate: string;
          do {
            candidate = `${prefix}${String(n).padStart(4, '0')}`;
            n++;
          } while (seenLegacyIds.has(candidate));
          // if original was duplicate, keep trace in reason
          if (legacyId && seenLegacyIds.has(legacyId.toUpperCase())) {
            // will be noted in creation
          }
          legacyId = candidate;
        }
        if (legacyId) seenLegacyIds.add(legacyId.toUpperCase());
        const rawPlan = planCol ? String(r[planCol] ?? '').trim() : '';
        // §2 Plan mapping
        let planName = '';
        let planType: string = isRadio ? 'RADIO' : 'FIBER';
        let planCategory = 'HOME';
        let planPriceKobo = 0;
        if (isRadio) {
          // PLAN is amount
          const amt = parseInt(String(rawPlan).replace(/[^0-9]/g, ''), 10);
          if (!isNaN(amt) && amt > 0) {
            planName = `Radio ${amt}`;
            planPriceKobo = amt * 100;
            planType = 'RADIO';
            planCategory = 'HOME';
          } else {
            planName = rawPlan ? `Radio ${rawPlan}`.trim() : 'Radio Unknown';
            planPriceKobo = 0;
          }
        } else if (isFiber) {
          // PLAN is tier name, trim whitespace (PLATINUM with trailing space)
          const tier = rawPlan.trim().replace(/\s+/g, ' ').toUpperCase().replace(/ +$/, '');
          planName = tier || 'Fiber Unknown';
          // normalize tier to level if needed, but keep name as tier
          planType = 'FIBER';
          planCategory = tier || 'HOME';
          planPriceKobo = 0; // fee not in PLAN for fiber; use amount col if present?
          // fee column for fiber is not used per spec; leave 0
        }
        // §1 Hikonnect ID generation (seq per type, legacyId kept)
        const hikonnectId = isRadio ? `Hikonnect Radio-${String(radioSeq++).padStart(4, '0')}` : `Hikonnect Fiber-${String(fiberSeq++).padStart(4, '0')}`;
        // §4 STATION free-text
        const stationLabel = stationCol ? (String(r[stationCol] ?? '').trim() || null) : null;
        // §3 duplicate legacyId: KEEP BOTH — do not skip, legacyId may repeat
        // §8 phone handling
        const rawPhone = phoneCol ? String(r[phoneCol] ?? '').trim() : '';
        const { primary: phonePrimary, secondary: phoneSecondary } = cleanPhoneSpec(rawPhone);
        // §5 IP handling
        const rawIp = ipAddressCol ? String(r[ipAddressCol] ?? '').trim() : '';
        const { ip: cleanedIp, needsFlag: ipFlagged, note: ipFlagNote } = cleanIpSpec(rawIp);
        let ipAddress: string | null = cleanedIp;
        let ipNote = '';
        if (ipFlagNote) ipNote = `IP flagged: ${ipFlagNote}`;
        // Fiber PPPOE blank by design (§5)
        if (isFiber && userTypeNorm === 'FIBER PPPOE' && !ipAddress) {
          ipAddress = null; // blank by design, not an error
        } else if (isRadio && !ipAddress) {
          ipNote = ipNote ? ipNote + ' · blank IP flagged for follow-up' : 'blank IP flagged for follow-up';
        }
        // duplicate IP tracking (§5: 15 total)
        let ipConflict = false;
        if (ipAddress) {
          const lowIp = ipAddress.toLowerCase();
          const cnt = (seenIps.get(lowIp) ?? 0) + 1;
          seenIps.set(lowIp, cnt);
          if (cnt > 1) {
            ipConflict = true;
            ipNote = ipNote ? ipNote + ` · duplicate IP ${ipAddress} (${cnt}×)` : `duplicate IP ${ipAddress} (${cnt}×)`;
          }
        }
        // §7 Dates
        const rawExpiry = dueCol ? r[dueCol] : null;
        const { date: expiryParsed, flagged: expiryFlagged } = parseExpirySpec(rawExpiry);
        let expiresAt: Date | null = expiryParsed;
        if (expiryFlagged) ipNote = ipNote ? ipNote + ' · expiry normalized to 2026-09-30' : 'expiry normalized to 2026-09-30';
        // START DATE: 566/566 empty → default to import date
        const startDateCol = headers.find(h => norm(h) === 'start date') ?? null;
        let startedAt: Date | null = null;
        if (startDateCol) {
          const rawStart = r[startDateCol];
          if (rawStart != null && String(rawStart).trim() !== '') {
            // strip stray . like 13./08/2026
            let s = String(rawStart).trim().replace(/\.\//g, '/');
            const d = new Date(s);
            startedAt = isNaN(d.getTime()) ? importDate : d;
          } else {
            startedAt = importDate;
          }
        } else {
          startedAt = importDate;
        }
        // §9 — capture all 16-column fields for display; passwords are hashed/not fabricated if blank
        const firstNameVal = firstNameCol ? String(r[firstNameCol] ?? '').trim() || null : null;
        const lastNameVal = lastNameCol ? String(r[lastNameCol] ?? '').trim() || null : null;
        const companyNameVal = companyCol ? String(r[companyCol] ?? '').trim() || null : null;
        const id2Val = id2Col ? String(r[id2Col] ?? '').trim() || null : null;
        const portalPasswordRaw = portalPassCol ? String(r[portalPassCol] ?? '').trim() : '';
        const radiusPasswordRaw = radiusPassCol ? String(r[radiusPassCol] ?? '').trim() : '';
        const nameFromCols = (String(r[nameCol ?? ''] ?? '').trim()
          || [firstNameVal ?? '', lastNameVal ?? ''].filter(Boolean).join(' '))
          || (companyNameVal ?? '');
        const name = nameFromCols || `Customer ${hikonnectId}`;
        const emailRaw = emailCol ? String(r[emailCol] ?? '').trim().toLowerCase().replace(/\s+/g, '') : '';
        const address = String(r[addressCol ?? ''] ?? '').trim() || null;
        const autoEmail = !emailRaw && legacyId ? `${legacyId.toLowerCase().replace(/[^a-z0-9._-]/g, '')}@local` : '';
        const useEmail = emailRaw || autoEmail || `row-${rowNo}-${hikonnectId.toLowerCase().replace(/[^a-z0-9]/g,'-')}@local`;
        const technology = isRadio ? 'RADIO' : 'FIBER';
        // Preserve exact USER TYPE for customer portal (e.g. "FIBER HOTSPOT", "FIBER PPPOE", "RADIO")
        const rawUserTypeForStorage = rawUserType.trim() || technology;
        // hasContent for PHPRadius: require at least name or legacyId or phone or address
        const hasContent = !!(name || legacyId || phonePrimary || address || planName);
        if (!hasContent) { skipped++; results.push({ row: rowNo, email: emailRaw, name, status: 'skipped', reason: 'empty row' }); continue; }

        try {
          // email dedup: if exists, generate unique variant instead of skipping (keep both per §3)
          let finalEmail = useEmail;
          let emailAttempt = 0;
          while (await this.prisma.user.findFirst({ where: { email: finalEmail }, select: { id: true } })) {
            emailAttempt++;
            finalEmail = `${useEmail.split('@')[0]}+${emailAttempt}@${useEmail.split('@')[1] ?? 'local'}`;
            if (emailAttempt > 5) break;
          }
          let subscriberId = '';
          let radiusNote = ipNote;
          let cpeNote = '';
          await this.prisma.$transaction(async (tx) => {
            const phoneTaken: Array<{ id: string }> = phonePrimary
              ? await tx.$queryRaw`SELECT id FROM "User" WHERE phone = ${phonePrimary} LIMIT 1`
              : [];
            const bcrypt = await import('bcryptjs');
            // Portal password from sheet (if present) becomes the login password; otherwise random
            const portalSecret = portalPasswordRaw || crypto.randomBytes(8).toString('hex');
            const passwordHash = await bcrypt.hash(portalSecret, 10);
            const user = await tx.user.create({
              data: { email: finalEmail, name: name || null, phone: phoneTaken.length ? null : phonePrimary, secondaryPhone: phoneSecondary, passwordHash },
              select: { id: true },
            });
            // For static IP (Radio with IP), also set Subscriber.staticIpAddress if not duplicate
            let subscriberStaticIp: string | null = null;
            let subscriberIpNote = '';
            if (isRadio && ipAddress) {
              const ipTakenForSub: Array<{ id: string }> = await tx.$queryRaw`SELECT id FROM "Subscriber" WHERE "staticIpAddress" = ${ipAddress} AND "deletedAt" IS NULL LIMIT 1`;
              if (ipTakenForSub.length) {
                subscriberStaticIp = null;
                subscriberIpNote = `static IP ${ipAddress} duplicate in Subscriber — left null, flagged for follow-up`;
                ipConflict = true;
              } else {
                subscriberStaticIp = ipAddress;
              }
            }
            const subscriber = await tx.subscriber.create({
              data: {
                tenantId: tenantId!,
                userId: user.id,
                type: 'RESIDENTIAL',
                status: 'ACTIVE',
                address: address || null,
                networkType: rawUserTypeForStorage || null,
                pppoeUsername: hikonnectId.toLowerCase().replace(/\s+/g, '-'),
                legacyId,
                hikonnectId,
                stationLabel,
                companyName: companyNameVal,
                id2: id2Val,
                firstName: firstNameVal,
                lastName: lastNameVal,
                staticIpAddress: subscriberStaticIp,
                staticIpNetmask: subscriberStaticIp ? '255.255.255.255' : null,
              } as any,
              select: { id: true },
            });
            subscriberId = subscriber.id;
            // Plan per §2
            let plan = await tx.plan.findFirst({ where: { tenantId, name: { equals: planName, mode: 'insensitive' }, type: planType as any }, select: { id: true } });
            if (!plan) {
              // For RADIO, price from plan amount; for FIBER, price 0 (or fee if present)
              const feeForPlan = isRadio ? planPriceKobo : 0;
              plan = await tx.plan.create({
                data: { tenantId: tenantId!, name: planName, type: planType as any, technology: planType, category: planCategory, speedMbps: 1, priceKobo: feeForPlan, installationFeeKobo: feeForPlan, isActive: true },
                select: { id: true },
              });
            }
            await tx.subscription.create({
              data: { subscriberId: subscriber.id, planId: plan.id, autoRenew: true, startedAt: startedAt ?? importDate, expiresAt, installationFeeKobo: isRadio ? planPriceKobo : 0 },
            });
            // §6 CPE: one per subscriber, always
            const syntheticMac = `UNASSIGNED-${hikonnectId.replace(/[^A-Z0-9]/g, '').slice(-10)}-${rowNo}`.toUpperCase().replace(/[^A-Z0-9-]/g, '-').slice(0, 30);
            const cpeIp = ipAddress; // may be null for PPPoE
            // check duplicate IP already flagged above, but still create CPE
            await tx.cpe.create({
              data: {
                subscriberId: subscriber.id,
                name: legacyId || name || hikonnectId,
                ipAddress: cpeIp,
                macAddress: syntheticMac,
                needsMacAddress: true,
                ipConflict,
                status: 'OFFLINE',
                connectionType: isRadio ? 'STATIC_IP' : 'PPPOE',
              } as any,
            });
          });
          // RADIUS activation — forward sheet PASSWORD if present, plus expiry
          const isStatic = false; // PHPRadius: never static per spec? but keep check
          if (legacyId && !isStatic) {
            const serviceToken = process.env.WEBHOOK_SERVICE_TOKEN;
            if (serviceToken) {
              try {
                const resp = await fetch(
                  `${process.env.RADIUS_SERVICE_URL ?? 'http://localhost:4106'}/api/v1/internal/radius/customers/${subscriberId}/activate`,
                  {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'x-webhook-token': serviceToken },
                    body: JSON.stringify({
                      ...(radiusPasswordRaw ? { password: radiusPasswordRaw } : {}),
                      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
                    }),
                  });
                const body = resp.ok ? ((await resp.json()) as { expiry?: string }) : null;
                const pwdNote = radiusPasswordRaw ? ' · radius pwd from sheet' : '';
                radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}${body?.expiry ? `radius on · expires ${body.expiry}${pwdNote}` : resp.ok ? `radius activated${pwdNote}` : `radius activation failed (${resp.status})`}`;
                if (portalPasswordRaw) radiusNote += ' · portal pwd set from sheet';
              } catch {
                radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}radius activation failed`;
              }
            } else if (radiusPasswordRaw || portalPasswordRaw) {
              radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}${radiusPasswordRaw ? 'radius pwd from sheet ' : ''}${portalPasswordRaw ? 'portal pwd from sheet ' : ''}· no service token, not sent`;
            }
          }
          if (ipNote) radiusNote = radiusNote ? radiusNote + ' · ' + ipNote : ipNote;
          if (cpeNote) radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}${cpeNote}`;
          created++;
          results.push({ row: rowNo, email: finalEmail, name, status: 'created', plan: planName || undefined, reason: radiusNote || `legacy ${legacyId ?? 'none'} → ${hikonnectId}` });
        } catch (e: any) {
          errors++;
          let reason = e?.message?.slice(0, 220) ?? 'unknown error';
          if (e?.code === 'P2002') {
            const target = String(e?.meta?.target ?? '');
            // Log full target for debugging
            console.error(`Import row ${rowNo} P2002 target=${target} email=${emailRaw} hikonnectId=${typeof hikonnectId !== 'undefined' ? hikonnectId : 'n/a'} legacyId=${typeof legacyId !== 'undefined' ? legacyId : 'n/a'}`, e?.message?.slice(0, 300));
            reason = target.includes('email') ? 'email already exists'
              : target.includes('hikonnectId') ? `hikonnectId duplicate (${target})`
              : target.includes('pppoeUsername') ? 'PPPoE username already taken'
              : target.includes('macAddress') ? `macAddress duplicate (${target})`
              : target.includes('phone') ? 'phone duplicate'
              : `duplicate ${target || 'unique constraint'}`;
          } else if (e?.code === 'P2003') {
            reason = 'references a missing record (invalid plan or parent)';
          } else {
            console.error(`Import row ${rowNo} error`, e);
          }
          results.push({ row: rowNo, email: emailRaw, name, status: 'error', reason });
        }
        job.created = created;
        job.skipped = skipped;
        job.errors = errors;
        job.rows = results;
        continue;
      }

      // ── Generic fallback (non-PHPRadius) ─────────────────────────
      const email = emailCol ? String(r[emailCol] ?? '').trim().toLowerCase().replace(/\s+/g, '') : '';
const name = String(r[nameCol ?? ''] ?? '').trim()
        || [String(r[firstNameCol ?? ''] ?? '').trim(), String(r[lastNameCol ?? ''] ?? '').trim()].filter(Boolean).join(' ')
        || String(r[companyCol ?? ''] ?? '').trim();
      const phone = String(r[phoneCol ?? ''] ?? '').trim();
      const address = String(r[addressCol ?? ''] ?? '').trim() || String(r[stationCol ?? ''] ?? '').trim();
      const planName = planCol ? String(r[planCol] ?? '').trim() : '';
      const fee = feeCol ? parseInt(String(r[feeCol ?? ''] ?? '').replace(/[^0-9]/g, ''), 10) || undefined : undefined;
      const expiresAt = (dueCol && toDate(r[dueCol])) || null;
      const pppoeUsername = usernameCol ? String(r[usernameCol] ?? '').trim() : '';
      const autoEmail = !email && pppoeUsername ? `${pppoeUsername.toLowerCase().replace(/[^a-z0-9._-]/g, '')}@local` : '';
      // Never reject a row for missing email: derive one from the PPPoE ID, or a
      // placeholder, so every row with any content is imported and all empty
      // fields simply stay blank (NULL).
      const useEmail = email || autoEmail || `row-${rowNo}@local`;
      const portalPassword = portalPassCol ? String(r[portalPassCol] ?? '').trim() : '';
      const radiusPassword = radiusPassCol ? String(r[radiusPassCol] ?? '').trim() : '';
      const userType = userTypeCol ? String(r[userTypeCol] ?? '').trim().toUpperCase() : '';
      const ipAddress = ipAddressCol ? String(r[ipAddressCol] ?? '').trim() : '';
      const technology = userType.includes('RADIO')
        ? 'RADIO'
        : userType.includes('FIBER')
          ? 'FIBER'
          : userType.includes('WIRELESS')
            ? 'RADIO'
            : '';

      const hasContent = email || name || phone || address || planName || pppoeUsername || ipAddress || portalPassword || radiusPassword || !!expiresAt || fee !== undefined;
      if (!hasContent) { skipped++; results.push({ row: rowNo, email, name, status: 'skipped', reason: 'empty row' }); continue; }
      const usernameKey = pppoeUsername.toLowerCase();
      if (pppoeUsername && seenUsernames.has(usernameKey)) {
        skipped++;
        results.push({ row: rowNo, email: useEmail, name, status: 'skipped', reason: `duplicate ID ${pppoeUsername} — already imported` });
        continue;
      }
      seenUsernames.add(usernameKey);

      try {
        const existing = await this.prisma.user.findFirst({ where: { email: useEmail }, select: { id: true } });
        if (existing) {
          skipped++;
          results.push({ row: rowNo, email: useEmail, name, status: 'skipped', reason: 'email already exists' });
          continue;
        }
        let subscriberId = '';
        let radiusNote = '';
        let cpeNote = '';
        if (autoEmail) radiusNote = `email auto-generated from ID (${autoEmail})`;
        else if (useEmail !== email) radiusNote = `email auto-generated (${useEmail})`;
        await this.prisma.$transaction(async (tx) => {
          // Split CONTACT NUMBER into primary/secondary per PHPRadius spec
          const { primary: phonePrimaryFallback, secondary: phoneSecondaryFallback } = cleanPhoneSpec(phone);
          // Raw read: a soft-deleted user still owns the unique phone slot, so
          // include them or the insert below fails on the phone constraint.
          const phoneTaken: Array<{ id: string }> = phonePrimaryFallback
            ? await tx.$queryRaw`SELECT id FROM "User" WHERE phone = ${phonePrimaryFallback} LIMIT 1`
            : [];
          const bcrypt = await import('bcryptjs');
          const passwordHash = await bcrypt.hash(portalPassword || crypto.randomBytes(8).toString('hex'), 10);
          const user = await tx.user.create({
            data: { email: useEmail, name: name || null, phone: phoneTaken.length ? null : phonePrimaryFallback || null, secondaryPhone: phoneSecondaryFallback, passwordHash },
            select: { id: true },
          });
          // Capture all sheet columns for customer portal display (16-field alignment)
          const firstNameValFallback = firstNameCol ? String(r[firstNameCol] ?? '').trim() || null : null;
          const lastNameValFallback = lastNameCol ? String(r[lastNameCol] ?? '').trim() || null : null;
          const companyNameValFallback = companyCol ? String(r[companyCol] ?? '').trim() || null : null;
          const id2ValFallback = id2Col ? String(r[id2Col] ?? '').trim() || null : null;
          let legacyIdFallback: string | null = idCol ? String(r[idCol] ?? '').trim() || null : null;
          // Enforce unique HIF/HIR — auto-generate if empty or duplicate
          if (!legacyIdFallback || (legacyIdFallback && seenLegacyIds.has(legacyIdFallback.toUpperCase()))) {
            const isRadioFallback = String(userType || technology || '').toUpperCase().includes('RADIO');
            const prefix = isRadioFallback ? 'HIR-' : 'HIF-';
            let n = 1;
            const existingNums = Array.from(seenLegacyIds).filter(v => v.startsWith(prefix)).map(v => parseInt(v.slice(prefix.length), 10)).filter(v => !isNaN(v));
            if (existingNums.length) n = Math.max(...existingNums) + 1;
            let candidate: string;
            do {
              candidate = `${prefix}${String(n).padStart(4, '0')}`;
              n++;
            } while (seenLegacyIds.has(candidate));
            legacyIdFallback = candidate;
          }
          if (legacyIdFallback) seenLegacyIds.add(legacyIdFallback.toUpperCase());
          const stationLabelFallback = stationCol ? String(r[stationCol] ?? '').trim() || null : null;
          const subscriber = await tx.subscriber.create({
            data: {
              tenantId: tenantId!,
              userId: user.id,
              type: 'RESIDENTIAL',
              status: 'ACTIVE',
              address: address || null,
              networkType: userType || technology || null,
              pppoeUsername: pppoeUsername || null,
              legacyId: legacyIdFallback,
              hikonnectId: pppoeUsername ? `Hikonnect ${technology || 'FIBER'}-${pppoeUsername.slice(0,8)}` : null,
              stationLabel: stationLabelFallback,
              companyName: companyNameValFallback,
              id2: id2ValFallback,
              firstName: firstNameValFallback,
              lastName: lastNameValFallback,
              staticIpAddress: ipAddress || null,
            } as any,
            select: { id: true },
          });
          subscriberId = subscriber.id;
          if (planName) {
            let plan = await tx.plan.findFirst({ where: { tenantId, name: { equals: planName, mode: 'insensitive' } }, select: { id: true } });
            if (!plan) {
              plan = await tx.plan.create({
                data: { tenantId: tenantId!, name: planName, type: technology || 'FIBER', technology: technology || 'FIBER', category: 'HOME', speedMbps: 1, priceKobo: fee ?? 0, installationFeeKobo: fee ?? 0, isActive: true },
                select: { id: true },
              });
            }
            await tx.subscription.create({
              data: { subscriberId: subscriber.id, planId: plan.id, autoRenew: true, expiresAt, installationFeeKobo: fee },
            });
          }
          if (ipAddress) {
            const ipTaken = await tx.cpe.findFirst({ where: { ipAddress: { equals: ipAddress, mode: 'insensitive' } }, select: { id: true } });
            if (!ipTaken) {
              await tx.cpe.create({
                data: { subscriberId: subscriber.id, name: pppoeUsername || name || null, ipAddress, macAddress: null, connectionType: 'STATIC_IP' },
              });
            } else {
              cpeNote = `static IP ${ipAddress} already in use — no CPE`;
            }
          }
        });

        // Activate on RADIUS right away for every non-STATIC connection type
        // (FIBER PPPOE, FIBER HOTSPOT, RADIO, ...) — the expiry is written
        // into FreeRADIUS (radcheck Expiration) so it's enforced the moment
        // the session starts.
        const isStatic = userType.includes('STATIC');
        if (pppoeUsername && !isStatic) {
          const serviceToken = process.env.WEBHOOK_SERVICE_TOKEN;
          if (serviceToken) {
            try {
              const r = await fetch(
                `${process.env.RADIUS_SERVICE_URL ?? 'http://localhost:4106'}/api/v1/internal/radius/customers/${subscriberId}/activate`,
                {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'x-webhook-token': serviceToken },
                  body: JSON.stringify({
                    ...(radiusPassword ? { password: radiusPassword } : {}),
                    ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
                  }),
                });
              const body = r.ok ? ((await r.json()) as { expiry?: string }) : null;
              radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}${body?.expiry ? `radius on · expires ${body.expiry}` : r.ok ? 'radius activated' : `radius activation failed (${r.status})`}`;
            } catch {
              radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}radius activation failed`;
            }
          } else {
            radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}radius activation skipped (no service token)`;
          }
        } else if (pppoeUsername && isStatic) {
          radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}static IP user${ipAddress ? ` · ${ipAddress}` : ''} — no RADIUS activation`;
        }
        if (ipAddress && !isStatic) radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}static IP ${ipAddress}`;
        if (cpeNote) radiusNote = `${radiusNote ? radiusNote + ' · ' : ''}${cpeNote}`;
        created++;
        results.push({ row: rowNo, email: useEmail, name, status: 'created', plan: planName || undefined, reason: radiusNote || undefined });
      } catch (e: any) {
        errors++;
        let reason = e?.message?.slice(0, 120) ?? 'unknown error';
        if (e?.code === 'P2002') {
          const target = String(e?.meta?.target ?? '');
          reason = target.includes('email')
            ? 'email already exists'
            : target.includes('pppoeUsername')
              ? 'PPPoE username already taken'
              : 'duplicate value (unique constraint)';
        } else if (e?.code === 'P2003') {
          reason = 'references a missing record (invalid plan or parent)';
        }
        results.push({ row: rowNo, email, name, status: 'error', reason });
      }
      job.created = created;
      job.skipped = skipped;
      job.errors = errors;
      job.rows = results;
    }

    await this.audit.log({
      actorId,
      action: 'CUSTOMERS_IMPORTED',
      entityType: 'User',
      entityId: 'bulk-import',
      metadata: { imported: created, skipped, errors, total: raw.length },
    });
    job.status = 'done';
    job.stage = 'done';
    job.created = created;
    job.skipped = skipped;
    job.errors = errors;
    job.rows = results;
    await this.invalidateCustomerCache();
  }
}
