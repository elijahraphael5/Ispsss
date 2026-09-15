import { Prisma, PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function credentialsKey(): Buffer {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!secret || secret === 'isp-dev-credentials-key' || secret === 'dev-credentials-key') {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY is required - set a strong random value');
  }
  return createHash('sha256').update(secret).digest();
}

/** AES-256-GCM. Output: v1:<iv>:<tag>:<ciphertext> (base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', credentialsKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', credentialsKey(), Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Safe preview for the UI — never returns the full secret. */
export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  if (secret.length <= 8) return '••••';
  return secret.slice(0, 7) + '…' + secret.slice(-4);
}

export interface TenantSmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromEmail?: string;
  fromName?: string;
}

/**
 * Resolves the tenant's UI-configured SMTP (Brevo) settings. Returns null when
 * the tenant has not enabled DB SMTP, so callers fall back to env config.
 */
export async function resolveTenantSmtp(prisma: any, tenantId: string | null | undefined): Promise<TenantSmtpConfig | null> {
  if (!tenantId) return null;
  const row = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      smtpEnabled: true,
      smtpHost: true,
      smtpPort: true,
      smtpUser: true,
      smtpPassEnc: true,
      smtpFromEmail: true,
      smtpFromName: true,
    },
  });
  if (!row?.smtpEnabled || !row.smtpHost || !row.smtpUser || !row.smtpPassEnc) return null;
  const pass = decryptSecret(row.smtpPassEnc);
  if (!pass) return null;
  return {
    host: row.smtpHost,
    port: row.smtpPort ?? 587,
    user: row.smtpUser,
    pass,
    fromEmail: row.smtpFromEmail ?? undefined,
    fromName: row.smtpFromName ?? undefined,
  };
}

// Every model in schema.prisma now carries a `deletedAt DateTime?` column, so
// soft-delete filtering is applied DB-wide. `EntityHistory` is the one
// exception: it is the append-only store of record for deleted/edited data and
// deliberately has no `deletedAt` column.
export const SOFT_DELETE_MODELS = [
  'tenant',
  'customRole',
  'permission',
  'user',
  'subscriber',
  'plan',
  'subscription',
  'invoice',
  'invoiceLine',
  'payment',
  'receipt',
  'creditNote',
  'refund',
  'wallet',
  'walletTransaction',
  'quotation',
  'quotationItem',
  'virtualAccount',
  'paymentAttempt',
  'paymentReconciliation',
  'ticket',
  'ticketComment',
  'chatSession',
  'chatMessage',
  'fileUpload',
  'agentPresence',
  'cannedResponse',
  'cpe',
  'networkDevice',
  'routerHealth',
  'contract',
  'refreshToken',
  'auditLog',
  'notification',
  'passwordResetToken',
  'actionQueue',
  'routerSnapshot',
  'routerMetric',
  'routerUsageDay',
  'pppoeSession',
  'coverageArea',
  'coverageZone',
] as const;

// Models whose UPDATE/DELETE writes are mirrored into `EntityHistory`.
// High-churn telemetry/auth tables are excluded so the history table does not
// balloon (these are written on every poll/heartbeat/request):
// routerMetric, routerUsageDay, pppoeSession, routerSnapshot, routerHealth,
// paymentAttempt, agentPresence, refreshToken, passwordResetToken,
// actionQueue, notification, auditLog.
export const HISTORY_MODELS = [
  'tenant',
  'customRole',
  'permission',
  'user',
  'subscriber',
  'plan',
  'subscription',
  'invoice',
  'invoiceLine',
  'payment',
  'receipt',
  'creditNote',
  'refund',
  'wallet',
  'walletTransaction',
  'quotation',
  'quotationItem',
  'virtualAccount',
  'paymentReconciliation',
  'ticket',
  'ticketComment',
  'chatSession',
  'chatMessage',
  'fileUpload',
  'cannedResponse',
  'cpe',
  'networkDevice',
  'contract',
  'coverageArea',
  'coverageZone',
] as const;

const READ_OPS = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
] as const;

/**
 * Injects `deletedAt: null` into a query's `where`, hiding soft-deleted rows
 * from read operations. Uses AND to ensure OR branches cannot bypass the
 * filter. Respects an explicitly-provided `deletedAt` (e.g. admin restore
 * view) and provides an escape hatch via `__includeDeleted: true`.
 */
export function filterDeletedAt(args: any): any {
  const a = args ?? {};
  // Escape hatch: caller explicitly wants deleted rows (restore/admin view)
  if (a.where && (a.where.__includeDeleted === true || a.where.deletedAt !== undefined)) {
    const { __includeDeleted: _ignored, ...rest } = a.where;
    // If deletedAt was explicitly set (including null), respect it
    if (_ignored !== undefined && a.where.deletedAt === undefined) {
      return { ...a, where: rest };
    }
    if (a.where.deletedAt !== undefined) {
      const { __includeDeleted: _2, ...restWhere } = a.where as any;
      return { ...a, where: restWhere };
    }
    return { ...a, where: rest };
  }
  const originalWhere = a.where ?? {};
  // If where is empty, just filter deleted
  if (!originalWhere || Object.keys(originalWhere).length === 0) {
    return { ...a, where: { deletedAt: null } };
  }
  return { ...a, where: { AND: [{ deletedAt: null }, originalWhere] } };
}

function buildQueryConfig(): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  for (const model of SOFT_DELETE_MODELS) {
    const ops: Record<string, unknown> = {};
    for (const op of READ_OPS) {
      ops[op] = async ({ args, query }: { args: any; query: (a: any) => any }) =>
        query(filterDeletedAt(args));
    }
    cfg[model] = ops;
  }
  return cfg;
}

/** Exposed separately so the filtering behaviour is unit-testable. */
export const softDeleteQueryConfig = buildQueryConfig();

/**
 * Prisma client extension that hides soft-deleted rows (deletedAt != null) from
 * read operations, now on EVERY model. It deliberately does NOT override
 * `delete`/`deleteMany`: hard deletes (import wipes, token cleanup, time-series
 * pruning) must keep working — the history extension records those deletes so
 * nothing is lost either way. Use `softDelete()`/`restore()` below for the
 * soft lifecycle.
 */
export const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete',
  query: softDeleteQueryConfig as any,
});

// Fields that must never be persisted in EntityHistory snapshots.
// Includes plaintext + ciphertext variants for encrypted secrets so history never leaks either form.
const SENSITIVE_KEYS = new Set([
  'passwordHash',
  'twoFaSecret',
  'twoFaOtpHash',
  'tokenHash',
  'routerosPassword',
  'routerosPasswordEnc',
  'secret',
  'paystackSecretKey',
  'paystackSecretKeyEnc',
  'smtpPass',
  'smtpPassEnc',
  'smtpPassword',
]);

/** Serializes a snapshot for JSONB storage, redacting sensitive fields. */
export function sanitizeForHistory(value: any): any {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(sanitizeForHistory);
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : sanitizeForHistory(v);
    }
    return out;
  }
  return value;
}

/** Distinguishes the soft-delete lifecycle from plain edits. */
export function actionForData(data: any): string {
  if (data?.deletedAt) return 'SOFT_DELETED';
  if (data?.deletedAt === null) return 'RESTORED';
  return 'UPDATED';
}

interface HistoryEntry {
  tenantId: string | null;
  model: string;
  recordId: string | null;
  action: string;
  before?: any;
  after?: any;
}

/**
 * Prisma client extension factory that mirrors UPDATE/DELETE operations on
 * `HISTORY_MODELS` into the `EntityHistory` table (before/after JSON
 * snapshots). History writes use the BASE client passed in, so they can never
 * recurse, and are fail-safe: a history insert failure never breaks the
 * primary write.
 *
 * Note: history writes issued while inside an interactive transaction are
 * committed independently of that transaction (Prisma query extensions cannot
 * reach the transaction's client for other models). If the surrounding
 * transaction rolls back, its history rows survive.
 */
export function createHistoryExtension(prisma: any) {
  const client = prisma as any;

  const record = async (entry: HistoryEntry) => {
    try {
      await client.entityHistory.create({
        data: {
          tenantId: entry.tenantId,
          model: entry.model,
          recordId: entry.recordId,
          action: entry.action,
          before: entry.before === undefined ? undefined : sanitizeForHistory(entry.before),
          after: entry.after === undefined ? undefined : sanitizeForHistory(entry.after),
        },
      });
    } catch {
      // History must never break the primary write (e.g. pre-migration DB).
    }
  };

  const extract = (
    where: any,
    before: any,
    after: any,
  ): { tenantId: string | null; recordId: string | null } => ({
    tenantId:
      ((after?.tenantId ?? before?.tenantId ?? where?.tenantId) as string | null | undefined) ?? null,
    recordId: ((after?.id ?? before?.id ?? where?.id) as string | null | undefined) ?? null,
  });

  const fetchBefore = async (model: string, where: any) => {
    try {
      return await client[model].findFirst({ where });
    } catch {
      return null;
    }
  };

  const cfg: Record<string, unknown> = {};
  for (const model of HISTORY_MODELS) {
    cfg[model] = {
      update: async ({ args, query }: { args: any; query: (a: any) => any }) => {
        const before = await fetchBefore(model, args.where);
        const result = await query(args);
        await record({
          ...extract(args.where, before, result),
          model,
          action: actionForData(args.data),
          before,
          after: result,
        });
        return result;
      },
      updateMany: async ({ args, query }: { args: any; query: (a: any) => any }) => {
        const result = await query(args);
        await record({
          ...extract(args.where, null, null),
          model,
          action: `${actionForData(args.data)}_MANY`,
          after: { where: args.where, data: args.data },
        });
        return result;
      },
      delete: async ({ args, query }: { args: any; query: (a: any) => any }) => {
        const before = await fetchBefore(model, args.where);
        const result = await query(args);
        await record({
          ...extract(args.where, before, result),
          model,
          action: 'DELETED',
          before: before ?? result,
          after: result,
        });
        return result;
      },
      deleteMany: async ({ args, query }: { args: any; query: (a: any) => any }) => {
        const result = await query(args);
        await record({
          ...extract(args.where, null, null),
          model,
          action: 'DELETED_MANY',
          after: { where: args.where },
        });
        return result;
      },
      upsert: async ({ args, query }: { args: any; query: (a: any) => any }) => {
        const before = await fetchBefore(model, args.where);
        const result = await query(args);
        await record({
          ...extract(args.where, before, result),
          model,
          action: 'UPSERTED',
          before,
          after: result,
        });
        return result;
      },
    };
  }
  return Prisma.defineExtension({
    name: 'entity-history',
    query: cfg as any,
  });
}

/**
 * Applies both extensions (whole-DB soft-delete filtering + EntityHistory
 * change capture) to a freshly constructed PrismaClient.
 *
 *   private client = applyPrismaExtensions(new PrismaClient(...));
 */
export function applyPrismaExtensions<T extends PrismaClient>(client: T): T {
  return client
    .$extends(softDeleteExtension)
    .$extends(createHistoryExtension(client)) as unknown as T;
}

/**
 * Soft-delete a single row by setting `deletedAt` (works on both a regular
 * delegate and an interactive-transaction `tx` delegate).
 *
 *   await softDelete(this.prisma.user, { where: { id }, select: { id: true } });
 */
export async function softDelete(delegate: any, args: any): Promise<any> {
  return delegate.update({
    ...args,
    data: { ...(args?.data ?? {}), deletedAt: new Date() },
  });
}

/** Bulk soft-delete by setting `deletedAt` (mirrors `updateMany`). */
export async function softDeleteMany(delegate: any, args: any): Promise<any> {
  return delegate.updateMany({
    ...args,
    data: { ...(args?.data ?? {}), deletedAt: new Date() },
  });
}

/** Restore a soft-deleted row by clearing `deletedAt`. */
export async function restore(delegate: any, args: any): Promise<any> {
  return delegate.update({
    ...args,
    data: { ...(args?.data ?? {}), deletedAt: null },
  });
}
