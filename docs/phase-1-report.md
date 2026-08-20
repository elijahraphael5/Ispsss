# Phase 1 — Service Extraction: Gateway + 4 Services

Date: 2026-08-13. All test suites green (102 tests across 5 packages); full stack smoke-tested through the gateway locally.

## Architecture

```
browser / frontends
   │  http + ws (socket.io)
   ▼
api gateway :4000   (NestJS; own routes: users, subscriptions, network, routeros, noc,
   │                  crm, reports, custom-roles, audit-logs, notifications, owner,
   │                  admin, customer, router-health, mail)
   │  prefix proxy        upgrade proxy (/socket.io)
   ├─▶ auth-service :4101     POST /api/v1/auth/*, refresh cookie path /api/v1/auth
   ├─▶ payments-service :4102 /api/v1/payments/* (incl. webhook/callback)
   ├─▶ billing-service :4103  /api/v1/billing/*, invoice-generator + overdue schedulers
   └─▶ support-service :4104  /api/v1/chat/*, /api/v1/support/*, socket.io /chat namespace
```

Shared: one PostgreSQL (same schema via prisma symlink), same `JWT_ACCESS_SECRET` (each
service verifies tokens itself), `REDIS_URL=none` default (jobs module skipped). No new infra.

## Files created / changed

### New service apps (scaffolded from api module trees, copied verbatim)
- `apps/auth-service/` — modules/auth + modules/mail; spec 18 tests
- `apps/payments-service/` — modules/payments + billing + audit-logs + notifications; spec 23 tests
- `apps/billing-service/` — modules/billing + audit-logs + notifications + `src/jobs/` (jobs.module.ts,
  invoice-generator.processor.ts, overdue.processor.ts); spec 19 tests
- `apps/support-service/` — modules/support + audit-logs + notifications + internal
  `POST /api/v1/chat/internal/customer-tickets` (webhook-token-guarded); spec 31 tests

Per service: `package.json` (workspace deps + `@nestjs/throttler ^6.2.0`, `@nestjs/swagger ^7.4.0`,
`pino ^9.5.0`), `tsconfig.json` (types trimmed), `jest.config.ts`, `.env` (from api; payments gets
`PAYSTACK_SECRET_KEY=test-secret-dev` for dev webhooks), `prisma/schema.prisma` → symlink to
`apps/api/prisma/schema.prisma`, `src/main.ts` (pino+request-id, /metrics /healthz /readyz with DB probe,
sliding-window rate limiter, cache Noop/Redis, CORS allow-list, ValidationPipe, AllExceptionsFilter,
`ConfigModule` envFilePath pinned to service dir), `src/app.module.ts` (AuditLogsModule +
NotificationsModule global; JwtAuthModule global).

### Shared package fixes (runtime `type-stripping` compat — raw TS loaded by Node)
- `packages/isp-logger/src/index.ts` — type-only named imports from pino
- `packages/isp-health/src/index.ts`, `packages/isp-cache/src/index.ts`,
  `packages/isp-rate-limit/src/index.ts` — constructor parameter properties → explicit fields

### api gateway changes
- `apps/api/src/gateway/service-proxy.middleware.ts` (new) — prefix proxy: `/api/v1/auth|payments|billing|chat|support` + `/socket.io`; JSON bodies re-serialized (api body-parser consumed them), raw streaming otherwise; Set-Cookie/Cookie pass-through; 502 on failure
- `apps/api/src/gateway/gateway.module.ts` (new) — registers middleware as express-level (global prefix would otherwise scope it to /api/v1)
- `apps/api/src/main.ts` — middleware wired via `app.use()`; socket.io `upgrade` proxy for `/socket.io` (HTTP 101 relay + bidirectional pipe to SUPPORT_SERVICE_URL)
- `apps/api/src/common/auth/jwt-auth.module.ts` + `jwt.strategy.ts` (new, copied from payments-service) — api-local JwtStrategy since AuthModule moved out
- `apps/api/src/app.module.ts` — removed AuthModule/BillingModule/PaymentsModule/SupportModule; added JwtAuthModule + GatewayModule; kept Mail/AuditLogs/Notifications/RouterHealth/Jobs
- `apps/api/src/modules/customer/support-client.service.ts` (new) + customer.module/controller — SupportService import replaced by HTTP client → `POST http://localhost:4104/api/v1/chat/internal/customer-tickets` (forwards Authorization, optional x-webhook-token; 503 on failure)
- `apps/api/src/jobs/jobs.module.ts` — trimmed to suspension/data-simulator/router-heartbeat (invoice-generator + overdue now owned by billing-service; avoids double consumers)
- `apps/api/src/modules/noc/gateways/noc.gateway.ts` — moved off `/socket.io` to `path: '/noc-socket'` (its io server was answering /socket.io and rejecting the proxied /chat namespace; no frontend uses it)
- `apps/api/src/modules/{auth,billing,payments,support}/` — deleted (now services)

### Ops
- `Dockerfile` (monorepo multi-stage) + `.dockerignore` (excludes dist, node_modules, `*.tsbuildinfo`)
- `docker-compose.yml` — postgres:16-alpine, redis:7-alpine, api + 4 services with per-service env + healthchecks. Validated AND running: `docker compose up -d` → 7/7 containers healthy, DB migrated (`prisma db push`) + seeded, e2e smokes (login/billing/support/chat socket) pass through the dockerized gateway.
- Container quirks fixed during bring-up: colima needs a non-root user (`ispcolima`, TMPDIR in $HOME — host /tmp is unwritable for non-root); stale `tsconfig.tsbuildinfo` in the build context caused container tsc to skip .js emit (`--no-cache` + ignore rule); runtime needs per-app `node_modules` (pnpm symlink dirs); Prisma engine selection on alpine/bookworm misdetected openssl → base image `node:24-bullseye-slim` (ships libssl.so.1.1, Prisma's default detection target).

## Run (dev, local, no Docker)

```sh
pnpm --filter api build && for s in auth-service payments-service billing-service support-service; do pnpm --filter $s build; done
# start 5 processes: node apps/<app>/dist/main.js  (4000 + 4101–4104)
```

Tests: `cd apps/<app> && npx jest` (api 11, auth 18, payments 23, billing 19, support 31).

## Smoke test (all through gateway :4000)

| Check | Result |
|---|---|
| POST /api/v1/auth/login | 201 + Bearer token |
| GET /api/v1/billing/dashboard (Bearer) | 200 |
| GET /api/v1/support/sessions?scope=queue (Bearer) | 200 |
| POST /api/v1/customer/tickets (customer) | 201 (SLA set) |
| POST /api/v1/payments/webhook/paysorta {} | 400 (routed to 4102) |
| socket.io /chat connect (agent, polling+ws upgrade) | connected, agent:count |

## Scale note (1M+ users target)

Gateway and services are horizontally scalable: stateless (AsyncLocalStorage tenancy, JWT-verified),
shared Postgres read-pool + Redis (BullMQ already conditional; enable REDIS_URL for jobs). Move
`suspension`/`data-simulator`/`router-heartbeat` to a worker tier, add a load balancer in front of :4000,
and shard Postgres (billing/payments are kobo-integer, partitioning-friendly). Frontends need no changes
(one origin). Remaining work is Phase 2 (FreeRADIUS/AAA), which this layout isolates behind the same
proxy pattern.

## Phase 1 completion update

### customer-service (new, :4105)
- Carved from api monolith: `customer`, `subscriptions`, `crm` modules → `apps/customer-service/` (NestJS, own package.json, tsconfig, jest config; prisma schema symlinked like siblings). Also carries service-only copies of `audit-logs`, `notifications`, `mail` (controllers stay in api — no route duplication).
- Ownership: writes Subscriber, Subscription, Plan, Cpe, Contract; reference-reads invoice/payment/receipt (subscription-action onboarding flow kept verbatim, incl. its legacy direct invoice/payment/receipt writes — flagged exception to the ownership matrix, zero behavior change). Ticket read/reply endpoints kept verbatim; ticket create already delegates to support-service internal endpoint (SupportClientService).
- Routes preserved 1:1: `/api/v1/customer/*`, `/api/v1/subscriptions/*`, `/api/v1/crm/*`; api kept `/users`, `/routeros`, `/network`, `/router-health`, `/noc`, `/audit-logs`, `/notifications`, `/reports`, `/owner`, `/admin`.
- Gateway routes added in `service-proxy.middleware.ts` → `CUSTOMER_SERVICE_URL ?? http://localhost:4105`.

### Bugs found & fixed
- Path matching used `req.originalUrl` → base paths with query strings (`/api/v1/subscriptions?search=..`) never proxied (only subpaths did). Fixed: match on `req.path`, forward `originalUrl`.
- api `app.spec.ts` caught a dropped `MailModule`/`AdminModule` import during carve (Nest DI).
- `tenant-isolation.spec.ts` (api) now loads `.env` explicitly (it bypasses ConfigModule; jest env had no DATABASE_URL).
- Docker CLI: homebrew client v29.6.2 lost `docker compose` plugin (Docker Desktop leftovers); use standalone `docker-compose` (v5.3.1) with `DOCKER_HOST=unix:///Users/ispcolima/.colima/default/docker.sock` + `DOCKER_CONFIG=/Users/ispcolima/.docker` (credsStore emptied — desktop cred helper missing).

### Phase 0 applied (already present in the 4 split services; added to api gateway)
api `main.ts` now: pino + `x-request-id` (generated or passthrough — also forwarded by the proxy), prom-client `/metrics`, `/healthz` + `/readyz` (DB probe via new `$queryRaw` passthrough on PrismaService), sliding-window IP rate limiter (DEFAULT_TIERS), helmet. Dockerfile EXPOSE 4105; compose adds `customer-service` (no host ports — internal).

### Full test suite (after Phase 1, real runner output)
| App | Suites | Tests |
|---|---|---|
| api | 3 | 11 passed |
| auth-service | 1 | 18 passed |
| payments-service | 1 | 23 passed |
| billing-service | 1 | 19 passed |
| support-service | 1 | 31 passed |
| customer-service | 8 | 71 passed |
| Total | 15 | 173 passed, 0 failed |

### E2E smoke (docker stack, through gateway :4000)
login 200; /customer/dashboard 200 (customer account); /customer/tickets 200; /subscriptions/plans 200; /subscriptions?search=.. 200; /crm 200; /support/sessions 200; /router-health 200; /healthz /readyz /metrics 200 (gateway + in-container readyz); socket.io /chat agent connect OK.
