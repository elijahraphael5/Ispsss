# ISP Platform — Agent Guide

## Commands (repo root, pnpm 9 + turbo 2)

| Action | Command |
|---|---|
| Install | `pnpm install` |
| Dev all | `pnpm dev` (turbo parallel) |
| Dev API only | `pnpm --filter api dev` → 4000 |
| Dev admin/customer | `pnpm --filter admin dev` → 3000 / `pnpm --filter customer dev` → 3001 |
| Dev service | `pnpm --filter auth-service dev` etc. (4101 auth, 4102 payments, 4103 billing, 4104 support, 4105 customer, 4106 radius) |
| Build all / API | `pnpm build` / `pnpm --filter api build` (`nest build`) |
| Lint | `pnpm lint` — **fails** (`eslint: command not found`), don't rely on it |
| Test all / one app | `pnpm test` / `pnpm --filter api test` (or `@isp/prisma`) |
| Prisma generate | `pnpm prisma:generate` (→ `pnpm --filter api prisma generate`) |
| Prisma drift check | `pnpm prisma:check` (`scripts/check-prisma-identical.mjs`, also CI) |
| Migrate / push | `pnpm prisma:migrate` or `cd apps/api && npx prisma db push --accept-data-loss` |
| Seed | `pnpm --filter api prisma:seed` (`tsx`, wipes + recreates demo chat/tickets) |
| Backup | `scripts/backup.sh` (pg_dump `isp_platform` + mysqldump `radius`; `BACKUP_DIR`/`KEEP_DAYS`, default 7d) |
| Full stack | `docker compose -f docker-compose.dev.yml up -d --build` (Postgres, Redis, MariaDB+FreeRADIUS, api+6 svcs, admin/customer, nginx) |
| Prod (Coolify) | `docker-compose.yaml` (Coolify expects this filename); env in `.env.production` |
| RADIUS e2e | `scripts/phase2-integration.sh` (needs docker stack; radtest + CoA) |

**After any `schema.prisma` edit:** copy `apps/api/prisma/schema.prisma` → 6 service `prisma/` dirs, `pnpm prisma:generate`, verify `pnpm prisma:check`. Must run before `nest build`.

## Architecture

- **Monorepo** `pnpm-workspace.yaml` (`apps/*`, `packages/*`) + Turborepo. Shared: `@isp/shared` (`api.ts` Bearer-aware fetch + refresh, `auth.ts` Zustand, `format.ts` `timeAgo`). Infra: `@isp/logger`, `@isp/metrics`, `@isp/health`, `@isp/rate-limit`, `@isp/cache`, `@isp/prisma` (no build step, `main`→`src/index.ts`).

- **Gateway + 6 microservices, one Postgres `isp_platform` + one JWT secret** (`change-me` if unset). Each service loads `apps/<app>/.env` via `ConfigModule.forRoot({ envFilePath: resolve(__dirname,'../.env') })`; `api` uses `ConfigModule.forRoot({ isGlobal:true })` (reads `process.cwd()` → root `.env` detached, `apps/api/.env` under turbo watch). `APP_PORT` (not `PORT`) controls `api` listen.

| Port | App | Controllers |
|---|---|---|
| 4000 | `api` | `users`, `network`, `routeros`, `router-health`, `noc`, `audit-logs`, `reports`, `custom-roles`, `notifications`, `admin`, `owner`, `mail` + socket.io proxy |
| 4101 | `auth-service` | `auth` (login/register/refresh/2FA), `mail` |
| 4102 | `payments-service` | `payments` (Paystack), `billing`, `radius`, `audit-logs` |
| 4103 | `billing-service` | `billing`, `radius`, `audit-logs` + jobs |
| 4104 | `support-service` | `support`+`chat`+Socket.IO, `audit-logs` |
| 4105 | `customer-service` | `customer`, `subscriptions`, `crm`, `mail` |
| 4106 | `radius-service` | `customers/:id/radius/*` + `/internal/radius/*` |

- **Gateway proxy** `apps/api/src/gateway/service-proxy.middleware.ts`: `/auth`→4101, `/payments`→4102, `/billing`→4103, `/chat`+`/support`+`/socket.io`→4104, `/customer`+`/subscriptions`+`/crm`→4105, `/customers`+`/radius`→4106; rest local. `main.ts` adds `setupSocketProxy`, `/metrics` `/healthz` `/readyz`, sliding-window rate limit + `ThrottlerModule`; `PROXY_TIMEOUT_MS` (30000) → 504/502.

- **Prisma schema** `apps/api/prisma/schema.prisma` — 41 models + 17 enums; byte-identical copy in 6 services (CI checks). All point at same DB; `db push`/`migrate` once from `api`.

- **Soft delete + history** `packages/isp-prisma` (`@isp/prisma`): `applyPrismaExtensions(client)` adds `deletedAt:null` filtering on read ops (`findMany`/`findFirst`/`findUnique`/count/aggregate/groupBy) for every model except `EntityHistory`, plus `softDelete`/`softDeleteMany`/`restore`. Every `PrismaService` (7 apps) + `owner.service.ts` uses it (verified via `packages/isp-prisma/src/index.ts:335` — failing logs run through history extension). `EntityHistory` rows (`model`,`recordId`,`action` `UPDATED|SOFT_DELETED|RESTORED|DELETED|UPSERTED`, `before`/`after` JSONB, `tenantId`) are fail-safe (try/catch, base client, outside transaction). Sensitive fields redacted; excluded: `routerMetric`,`routerUsageDay`,`pppoeSession`,`routerSnapshot`,`routerHealth`,`paymentAttempt`,`agentPresence`,`refreshToken`,`passwordResetToken`,`actionQueue`,`notification`,`auditLog`. `delete`/`deleteMany` stay HARD (import wipe, token cleanup, time-series) and are recorded.

  Soft-delete models: `User`,`Subscriber`, financial chain (`Invoice`/`InvoiceLine`/`Payment`/`Receipt`/`CreditNote`/`Refund`/`Wallet`/`WalletTransaction`), `CustomRole` (name freed on recreate as `deleted-<id>`), `Cpe` (unique `macAddress` nulled on soft delete), `CannedResponse`,`CoverageArea`,`Plan` etc. — all carry `deletedAt`. Hard-delete-only: time-series (`routerMetric`,`routerSnapshot` …) + token/attempt tables. `clearCustomerData` (import wipe + purge) matches children via parent relations (not filtered ID lists) and raw-reads **all** subscribers (`SELECT ... WHERE "tenantId"`) so soft-deleted customers don't leave subscriptions blocking `plan.deleteMany` (`Subscription_planId_fkey` P2003).

  Unique handling: live duplicate `User.phone` / `Subscriber.pppoeUsername` → `409` (stale soft-deleted holder auto-released via raw `$queryRaw` before create); `CustomRole.name` stale holder renamed on next create; `Cpe.macAddress` nulled on `deleteCpe` and on customer delete (`subscriptions.service`).

- **`frontend/`** — old mock-data monorepo (admin 3001, customer 3000). Ignore for backend work.

- **Cross-cutting** — tenant via `AsyncLocalStorage` (`tenantId` UUID; `prisma.tenant.findFirst({where:{slug:'default'}})`). `ValidationPipe` `whitelist`+`forbidNonWhitelisted`+`transform` (unknown →400). Exception filter `{statusCode,path,message,timestamp}` (logs + Sentry if `SENTRY_DSN`); Prisma errors bubble as `UnknownRequestError` with full code hidden from client — check server logs.

- **Auth** — 15m JWT + 7d refresh family (hashed, rotation); TOTP 2FA. `isSuperAdmin` bypasses; else `@Roles` checks `customRole.name`.

- **Billing** — `DRAFT→ISSUED→PAID|OVERDUE|VOID`; `ISSUED→PAID` only via Paystack webhook (`x-paystack-signature` HMAC-SHA512).

- **PDFs/email** — billing/payments `PdfService` (`pdfkit`); `PATCH /billing/:id/issue` (`{email?}`) and `PATCH /billing/quotations/:id/status` (`SENT`) email PDFs; `GET /billing/:id/pdf` via `res.end`. Keep `GET :id` after static routes.

- **BullMQ** — `REDIS_URL=none` skips `JobsModule` (NoopCache). Queues `removeOnComplete:true, removeOnFail:500`. api: `suspension` :30, `data-simulator` 60s (only `ENABLE_DATA_SIMULATOR=true`), `router-heartbeat` 30s.

## Gotchas

- **Stale `.next` + build race** — `rm -rf apps/<app>/.next` if `__webpack_modules__[moduleId] is not a function` / `ChunkLoadError`. Never run `pnpm --filter customer build` (or any `next build`) while `pnpm dev` owns `.next` — it replaces dev chunks with production chunks.
- **API crashes silently** — check `/tmp/api-*.log`; 500s are usually `P2002` (duplicate email/phone/pppoeUsername) or `P2025` (already soft-deleted row via `findUniqueOrThrow`).
- **Server must survive tool timeout** — `python3 -c "import subprocess,os; f=open('/tmp/api.log','a'); subprocess.Popen(['node','apps/api/dist/main.js'],stdout=f,stderr=f,start_new_session=True,cwd=os.getcwd())"` (build first). Same for `apps/<svc>/dist/main.js` 4101–4106. Kill stale `nest start --watch` before.
- **Duplicate phone/pppoeUsername → 409, not 500** — `POST /users` and `POST /subscriptions` pre-check via raw query; stale (soft-deleted) holders auto-released, live duplicates throw `ConflictException`. Watch for `P2002` meta `target: ["phone"|"pppoeUsername"]`.
- **Soft-delete double delete → 404** — `DELETE /users/:id`, `/network/cpes/:id`, `/support/canned/:id` now soft-delete + 404 on repeat (was `P2025` 500 via raw `.delete()` / `findUniqueOrThrow`). `DELETE /custom-roles/:id` and `DELETE /coverage-areas/:id` also soft-delete; `CustomRole.name` clash on re-create is handled by renaming stale row. History rows commit outside any `$transaction`.
- **SMTP port 465** (587 blocked); `secure: Number(port)===465`. `MailService.send()` swallows errors — 200 ≠ delivered.
- **Customer import** `POST /users/import` (5→25MB, `xlsx`), returns `{jobId}` → poll `GET /users/import/:jobId`. Wipes **all** tenant customers (incl. soft-deleted, via raw `SELECT`) so re-import is clean; `plan.deleteMany` would otherwise P2003. Per-row phone check raw-includes soft-deleted users. `POST /users/purge-customers` same wipe; add `Purge` confirmation modal.
- **Customer create** `POST /users` → `POST /subscriptions` → `POST .../subscriptions` (plan+fee) → `POST .../cpes` → `POST .../send-welcome`; wizard uses `Promise.allSettled` for follow-ups.
- **NOC/RADIUS** `GET /api/v1/radius/stats` roles SUPER_ADMIN/OPS/NOC; `RadiusStatsController` must be in `radius.module.ts` `controllers`. NOC tabs Overview/RouterOS/RADIUS/Connections.
- **Admin login after schema change** — clear `localStorage.accessToken`.
- **Auth header** — `accessToken` stored with `Bearer ` prefix; `api()` sends `Authorization: <token>` verbatim.
- **Money kobo** integers; VAT `Math.round(k*0.075)`; `api()` body must be `JSON.stringify`.
- **Customer coverage** — `apps/customer/src/app/coverage/page.tsx` (Leaflet + OSM, `dynamic` `ssr:false`, no API key). Nav `CustomerSidebar` item `Coverage` → `/coverage` (map-pin); `InstallationGate` `ALLOWED_PREFIXES` includes `/coverage` so it stays viewable while installation-locked. Dashboard Fiber Coverage widget (zone-grouped list, 300px map) now links "View all coverage →" and includes `focus` prop so list rows pan the map.
- **Real secrets committed** — `.env` / `apps/*/.env` contain live Paystack/SMTP. Never paste into code/logs.
- **CI** `.github/workflows/ci.yml` (push/PR): `install --frozen-lockfile` → `prisma:generate` → `check-prisma-identical` → build 7 apps → `pnpm test`. No frontend build, no ESLint.

## Production hardening

- `assertProdEnv` (`@isp/logger`) in every `main.ts`; `Sentry` only in `api` gateway (filter captures).
- CORS `CORS_ORIGINS` (default `http://localhost:3000,http://localhost:3001`).
- Rate limit (`@isp/rate-limit`): gateway mutation 120/read 600/global 1200 per min, keyed per **user** when JWT present; auth-service 10/30/600; radius-service 60/300 (internal exempt). `data-simulator` off unless `ENABLE_DATA_SIMULATOR=true`.
- Paystack only gateway; webhook `<NGINX_API_HOST>/api/v1/payments/webhook/paystack`; `WEBHOOK_SERVICE_TOKEN` required for internal routes.
- Compose `docker-compose.yaml` (Coolify) + `docker-compose.dev.yml`; nginx image bakes `infra/nginx/nginx.conf` (not bind mount); `init` one-shot `cd apps/api && prisma migrate deploy && tsx prisma/seed-prod.ts`; `next start` needs `working_dir: /repo/apps/<app>`.

## Support / RouterOS / Audit / Frontend / KYC / Session / Maker-checker

- **Support** (`support-service` `support.*`): `SLA_HOURS`, agent roles, `/chat` namespace, events `chat:*`, rooms `agents`/`customers`/`session:${id}`, message `body`/`senderType`, attachments via `FileUpload` (`apiUpload`/`apiFileUrl`, 15MB). No calls module.
- **RouterOS** — `arpFetch` toggles `NODE_TLS_REJECT_UNAUTHORIZED`; `RouterHealth` heartbeat 30s; `Cpe.connectionType` `PPPOE|STATIC_IP`; RADIUS wiring `RADIUS_NAS_IP` = router public IP, CoA 3799.
- **Audit logs** — `beforeData`/`afterData`; `POST /audit-logs/:id/rollback` (SUPER_ADMIN) via `MODEL_MAP`; `/audit-logs` shows diff.
- **Frontend** — `#F15925`, pill buttons, `.data-card`, drawers; `AuthInit` after mount; `Sidebar.tsx` `navItems` + module permission filter.
- **Default login** prod `admin@isp.local/admin123` (tenant admin), `root@isp.local/R8k!mP9xL2#s` (superadmin); dev adds `billing@`/`noc@`/`ops@`/`support@`/`field@`/`agent1@`/`agent2@` `/admin123`.
- **KYC/maker-checker** — `PENDING_KYC` excluded from customers table; `/kyc` approve/reject; `assertNotMaker` on delete/approve (`SUPER_ADMIN`/`isSuperAdmin` exempt).
- **Idle timeout** — client `startIdleSessionTimeout` + server `SESSION_IDLE_TIMEOUT_MS` (3600000); refresh within 2m keeps alive.
