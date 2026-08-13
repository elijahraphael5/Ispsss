# ISP Platform — Agent Guide

## Commands (run from repo root)

| Action | Command |
|---|---|
| Install deps | `pnpm install` |
| Dev (all) | `pnpm dev` |
| Dev (API only) | `pnpm --filter api dev` |
| Dev (admin only) | `pnpm --filter admin dev` (port 3000) |
| Dev (customer only) | `pnpm --filter customer dev` (port 3001) |
| Build all | `pnpm build` |
| Build API | `pnpm --filter api build` (uses `nest build`) |
| Lint | `pnpm lint` (references eslint but no config files exist — effectively no-op) |
| Test (API only) | `pnpm --filter api test` |
| Push schema (dev) | `cd apps/api && npx prisma db push --accept-data-loss` |
| Generate Prisma client | `pnpm --filter api prisma:generate` |
| Run migrations | `pnpm --filter api prisma:migrate` (runs `prisma migrate dev`) |
| Seed DB | `pnpm --filter api prisma:seed` (uses `tsx`) |

Prisma client **must** be regenerated after schema changes before `nest build` passes.
Note: `pnpm prisma:generate` (root) is broken — it runs `prisma generate` as a script name and fails with "None of the selected packages has a 'prisma' script". Use `pnpm --filter api prisma:generate`.

## Gotchas

- **Stale `.next` cache** — if admin/customer crashes after rebuild (`__webpack_modules__[moduleId] is not a function`), `rm -rf apps/<app>/.next` and restart the dev server
- **API crashes silently** — check `/tmp/api-*.log`; 500s are usually Prisma unique constraint violations from duplicate emails
- **Server must survive tool timeout** — use `python3 -c "import subprocess, os; f=open('/tmp/api.log','a'); subprocess.Popen(['node','apps/api/dist/main.js'], stdout=f, stderr=f, start_new_session=True, cwd=os.getcwd())"`
- **Admin login fails after schema changes** — clear `localStorage.accessToken` and log in fresh
- **Auth header uses raw token** — `api<T>()` from `@isp/shared` sends `Authorization: <token>` (no "Bearer " prefix)
- **Money in kobo** — all values are integers (kobo), never floats. VAT = `Math.round(priceKobo * 0.075)`
- **BullMQ jobs are conditional** — `REDIS_URL=none` (default) skips `JobsModule` entirely; no Redis needed for basic dev. Redis is installed locally (`/opt/homebrew/bin/redis-server`; brew service broken by a missing redisbloom module — run the binary directly with `--save "" --appendonly no`); with Redis on, `data-simulator` fires every 60s and creates fake sessions/invoices/payments
- **`timeAgo()` in `@isp/shared`** — relative-time util exported from `packages/shared/src/format.ts`; use for stale/health timestamps
- **Delete is HARD delete** — cascades through all related records via `prisma.$transaction`
- **Both apps proxy `/api/v1/*` to `localhost:4000`** — `next.config.js` rewrites avoid CORS during dev
- **No docker-compose.yml in repo** despite docs referencing it; must be created locally if needed
- **No CI/CD** — `.github/` does not exist
- **`api()` body must be a string** — `RequestInit.body` type rejects object literals; always `body: JSON.stringify({...})` or the build fails typecheck
- **`useToast` is NOT a chained API** — `toast(msg, type, toasts, setToasts)` with a local `toasts` state + `<ToastContainer toasts={toasts}/>`; `toast.success()`/`.error()` do not exist

## Architecture

- **Monorepo** — pnpm workspaces + Turborepo v2
- **Apps** — `apps/api/` (NestJS 10, port 4000), `apps/admin/` (Next.js 15, port 3000), `apps/customer/` (Next.js 15, port 3001)
- **Shared** — `packages/shared/`: fetch wrapper (`api.ts`) + Zustand auth store (`auth.ts`)
- **`frontend/`** — separate/older monorepo with the same 3 apps but mock-data-based frontends; for UI review without API
- **DB** — PostgreSQL via Prisma 5; 36 models + 17 enums; schema at `apps/api/prisma/schema.prisma`
- **Tenant isolation** — `AsyncLocalStorage`-based, injected via global interceptor; every core entity has `tenantId`
- **Tenant IDs are UUIDs, not slugs** — look up with `prisma.tenant.findFirst({ where: { slug: 'default' } })`; never assume `tenantId: 'default'`
- **Global ValidationPipe** — `whitelist: true, forbidNonWhitelisted: true, transform: true` (unknown fields → 400)
- **Global exception filter** — returns `{ statusCode, path, message, timestamp }`; Prisma errors → 500
- **Auth** — 15min JWT access token + 7d httpOnly refresh cookie; speakeasy TOTP 2FA; `User.isSuperAdmin` bypasses all guards; otherwise `@Roles('NAME')` checks `user.customRole.name`
- **Billing state machine** — `DRAFT → ISSUED → PAID | OVERDUE | VOID`; `ISSUED → PAID` only via Paystack webhook
- **18 domain modules** (`src/modules/`) + 1 separate `OwnerModule` (`src/owner/`)
- **No ESLint/Prettier configs** — lint commands reference `eslint` / `next lint` but no config files exist; no formatter configured
- **Frontend tsconfig has `strict: false`** — admin and customer apps have relaxed type checking
- **Scheduled jobs** (BullMQ, need Redis): `invoice-generator` (daily 02:00), `overdue` (hourly), `suspension` (hourly :30), `data-simulator` (every 60s)
- **DB model count** has grown — schema now includes `ChatSession`, `ChatMessage`, `Ticket`, `TicketComment`, `CannedResponse`, `AgentPresence` (all tenant-scoped; see Support/Chat section)

## Support: Live Chat + Tickets (`src/modules/support/`)

- **Module layout** — `support.module.ts` exports `SupportService`, `SupportController` (`/api/v1/support/*`, agent-facing, `@Roles` VIEW: SUPER_ADMIN/SUPPORT_AGENT/CUSTOMER_SUPPORT/OPERATIONS_MANAGER/NOC_ENGINEER, WRITE: SUPER_ADMIN/SUPPORT_AGENT/CUSTOMER_SUPPORT), `SupportCustomerController` (`/api/v1/chat/*`, any authenticated user), and `SupportGateway` (Socket.IO, namespace `/chat`)
- **Socket auth** — gateway accepts `auth.token` or `query.token` (strips optional `"Bearer "` prefix, verifies via `JWT_ACCESS_SECRET`), falls back to `query.userId` legacy style. Tenant is always read from the DB user record, never trusted from client claims. `query.role: 'agent'` REQUIRED to get agent identity (`AGENT_ROLES = ['SUPPORT_AGENT','CUSTOMER_SUPPORT']`, isSuperAdmin bypasses); otherwise the socket is a customer
- **Socket events (client→server)** — `chat:getAgents` (→ `agent:count`), `chat:join(sessionId)` / `chat:leave`, `chat:typing {sessionId,isTyping}`, `chat:message {sessionId, body, attachmentIds?}` (sender derived from identity — DO NOT trust client sender fields), `chat:read(sessionId)`
- **Socket broadcasts (server→client)** — `chat:message` (ChatMessage, to session room), `chat:new` / `chat:changed` / `chat:activity` (to `agents` room), `chat:assigned {sessionId,agentId}`, `chat:sessionChanged` (to session room), `chat:read {sessionId,senderType,readAt}`, `chat:typing`, `agent:online`/`agent:offline`
- **Rooms** — `agents` (all agents), `customers`, `session:${id}`. Agents auto-join `agents` on connect; customers must `chat:join` per session (access-checked: agent role + tenant, assigned or unassigned; customer must be the session owner)
- **Message shape** — `{id, sessionId, senderId, senderName, senderType: CUSTOMER|AGENT, body, status: SENT|DELIVERED|READ, deliveredAt, readAt, createdAt, attachments?}`. Field is `body` (**not** `message`), and staff flag is `senderType === 'AGENT'` (**not** `isStaff`) — the old pre-rewrite frontends used `message`/`isStaff` and must not be copied
- **Attachments** — `FileUpload` model (tenant-scoped, `sessionId?`/`messageId?`/`ticketId?`/`ticketCommentId?` relations with `onDelete: Cascade`; `storedPath` is relative to `UPLOAD_DIR` env or `uploads/` at repo root — gitignored). Upload: `POST /chat/sessions/:id/attachments` (multipart field `file`, 15 MB cap via memoryStorage; agent or session owner) and `POST /support/tickets/:id/attachments` (WRITE roles, agents). Download: single `GET /chat/attachments/:id` (any authenticated user; access = agent role OR subscriber owns session/ticket/comment; streams with `Content-Disposition: inline`). Link files to messages/comments by sending `attachmentIds: string[]` in `POST /chat/sessions/:id/messages`, `chat:message` socket payload, or `POST /support/tickets/:id/comments` — server filters to rows uploaded by the sender (`uploadedById`, unlinked `messageId`/`ticketCommentId` null). `FileUpload` is in `TENANT_MODELS` + audit `MODEL_MAP`. Frontends use `apiUpload(path, File)` / `apiFileUrl(uploadId)` from `@isp/shared` (FormData + blob object URL; don't use `api()` for these — it forces `Content-Type: application/json`)
- **Session lifecycle** — `createSession` returns an **open (WAITING/ACTIVE) session for the same subscriber instead of creating a duplicate**. Agent reply sets status ACTIVE + `firstResponseAt` + auto-assigns `agentId`; `PATCH close` sets CLOSED + closedAt; customer can rate 1–5 once (`csat`) after close; `1stResponseAt`/readAt feed performance metrics
- **Agent endpoints** — `GET /support/sessions?scope=queue|assigned|closed` (rows incl. `lastMessage` + `unreadCount`), `GET /support/sessions/:id` (full detail incl. subscriber context: plan, devices, invoices, tickets), `POST /sessions/:id/pick-up`, `reassign {agentId}`, `/read`, `PATCH /close`, `POST /convert-ticket` (creates Ticket with `sourceChatSessionId`; idempotent — returns existing), `GET /support/agents`, `PATCH /support/presence` (`ONLINE|AWAY|OFFLINE`), `GET/POST/PATCH/DELETE /support/canned`, `GET /support/customers?search=` (tenant-scoped subscriber lookup for ticketing — supports the SUPPORT_AGENT role, which cannot call `GET /users`), `GET/POST /support/tickets`, `PATCH /support/tickets/:id` (audits before/after + sets `resolvedAt` on RESOLVED/CLOSED), `POST /support/tickets/:id/comments` (agents only; `internal: true` → internal note), `GET /support/performance?range=today|week|month`, `GET /support/history`
- **Customer-side endpoints** — `POST /chat/sessions` (+migration to `GET /chat/sessions`), `GET /chat/sessions/:id`, `POST /chat/sessions/:id/messages {body}`,`PATCH /chat/sessions/:id/close` (customer or owner), `POST /chat/sessions/:id/rating {rating}`; tickets: `GET /customer/tickets`, `GET /customer/tickets/:id`, `POST /customer/tickets` (`{subject, description?, category?, priority?}`), `POST /customer/tickets/:id/reply {message}` (customer-only reply)
- **SLA** — `LOW:48h, MEDIUM:24h, HIGH:8h, URGENT:2h` (map `SLA_HOURS` in `support.service.ts`); `slaDueAt` is set on ticket/create/convert; `POST /support/tickets` of HIGH/URGENT also creates a notification
- **Admin UI** — `/tickets` (nav "Support", module `Support`) is the hub: tabs `Live Chat | Tickets | Canned Replies | Performance`; `socket.io-client` connects with `{auth:{token}, query:{role:'agent'}}`; canned replies insert into composer; tickets/open from either table or drawer; performance table + CSAT + resolution metrics
- **Customer UI** — `/support` page: Live Chat tab (start chat / resume previous sessions list), ticket table + creation drawer, ticket detail with thread + description, customers cannot see internal notes (`filter c => !c.internal`)
- **No calls** — the WebRTC call module (`CallSession` model, `call:*` socket events, `CallManager`, call stores/overlays, Calls tab) was **removed** in Aug 2026; don't reintroduce it without asking
- **Seed data** — same `agent1@ap-example`/`agent2@ap-example` demo + `support@isp.local` users; canned responses; 2 WAITING/2 ACTIVE/4 CLOSED sessions with timestamps; 5 tickets; `SUPPORT_AGENT` role in ROLE_PERMISSIONS
- If the DB was re-seeded with `--force-reset`, chat/ticket content resets too

## RouterOS / Connections

- **ARP sync** — `POST /routeros/sync-arp` (optional `deviceId` in body) fetches ARP entries from a `NetworkDevice` with RouterOS creds, creates User + Subscriber + Cpe with `connectionType: STATIC_IP`. No deviceId → falls back to newest device with `routerosUsername`/`routerosPassword` set; throws if none. `GET /routeros/arp-entries` (same `?deviceId=`) returns raw entries
- **Self-signed cert** — `arpFetch()` sets `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'` around requests (restores prior value in `finally`); don't remove
- **Router health** — `RouterHealth` model (1:1 with `NetworkDevice`); BullMQ job `router-heartbeat` (every 30s, Redis only) pings each RouterOS-configured device via `/system/resource`, writes `linkStatus: up|unreachable` + `lastSeenAt`/`lastErrorAt`. Devices without RouterOS creds are skipped. `GET /api/v1/router-health` returns rows with `device` included; dashboard + `/users/manage` show a `stale · <timeAgo>` chip + banner when the active device isn't `up`
- **`/network/connections` semantics** — `totalPppoe` counts **active** PPPoE sessions only; `totalStatic` counts **all** STATIC_IP CPEs. For true PPPoE totals use `/routeros/devices/{id}/subscribers` (`active` boolean per secret)
- **`Cpe.connectionType` enum** — `PPPOE | STATIC_IP`; static IP CPEs are the only source of truth for static customers

## Audit logs (before/after + rollback)

- `AuditLog` model has `beforeData` / `afterData` JSON fields (plus legacy `metadata`); pass them to `audit.log({ beforeData, afterData })`
- Only `users.service.ts` currently captures snapshots (email/phone/customRoleId/isSuperAdmin). Other services log metadata only — extend before expecting diffs
- **Rollback** — `POST /audit-logs/:id/rollback` (SUPER_ADMIN only). `*_CREATED` → delete entity; `*_UPDATED` with `beforeData` → restore snapshot; `*_DELETED` with `afterData` → re-create. Runs in `prisma.$transaction`; supports entity types in `MODEL_MAP` in `audit.service.ts`
- Frontend `/audit-logs` shows inline diff (red strikethrough before → green after) + Rollback button for eligible entries

## Frontend conventions

- Orange primary (`#F15925` / `#FF6224`), pill buttons (20px radius), `.data-card` (24px radius), right-side sliding drawers
- Auth init via `AuthInit` component reads `localStorage` after mount (never at module init — prevents SSR hydration errors)
- Charts use both Recharts (Dashboard) and @visx (analytics)
- **Nav** — `apps/admin/src/components/Sidebar.tsx`: `navItems` array, per-item `module` matched against `customRole.permissions` for view filtering; `superAdminOnly` for Owner; Settings is last item
- **Settings page** — `/settings`: Admin Users tab (role dropdown, super-admin toggle, reset password via `POST /users/:id/reset-password` which returns `{ newPassword }`), Roles tab (permission dots), Security tab (change own password via `PATCH /users/:id`)
- **Customer page** (`/users/manage`) merges RouterOS PPPoE secrets + static IP CPEs into one table with `All | PPPoE | Static IP` filter tabs
- **Dashboard** — PPPoE stats come from RouterOS secrets (all, not just active); Static IP stats from `/network/connections` filtered by type; 4-segment Connections Distribution donut (PPPoE Active/Disabled, Static Active/Offline); Traffic & Connections chart polls every 5s via `Promise.all` of bandwidth + sessions + connections + system
- Customer create flow: `POST /users` → `POST /subscriptions` (with address) → `POST .../subscriptions` (planId, installationFeeKobo, routerProvided) → `POST .../cpes` → `POST .../send-welcome`

## Default login

`admin@isp.local` / `admin123` (tenant admin, `isSuperAdmin: false`)
`root@isp.local` / `R8k!mP9xL2#s` (superadmin, `isSuperAdmin: true`)
`agent1@isp.local` / `admin123`, `agent2@isp.local` / `admin123` (SUPPORT_AGENT demo agents)
