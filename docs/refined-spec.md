# ISP Management Platform — Refined Engineering Spec

Precision pass on the original prompt. Original was a feature/tech wishlist;
this resolves the ambiguities that block implementation: framework choice,
data model, module boundaries, phasing, and non-functional targets stated as
testable numbers instead of adjectives.

## 1. Scope decisions (were ambiguous or unstated in original)

| Question | Original | Decision |
|---|---|---|
| Monorepo or separate repos? | unstated | Monorepo: pnpm workspaces + Turborepo. `apps/api`, `apps/admin`, `apps/customer`, `packages/shared` |
| Express or NestJS? | listed both, "NestJS recommended" | NestJS locked. Reason stated in original (RBAC, DI) is valid; do not revisit |
| REST or GraphQL? | "GraphQL Gateway" under API optimization, but every other section assumes REST | REST + OpenAPI (`@nestjs/swagger`) for v1. GraphQL gateway deferred to Phase 4 — do not build both concurrently, it doubles the contract surface for no MVP benefit |
| MinIO vs S3 vs R2 | listed as alternatives | MinIO self-hosted for dev/on-prem, S3-compatible SDK so prod can swap to R2/S3 without code change |
| "Multi-tenant" | listed as a target, never modeled | Deferred. Nothing in the schema, RBAC, or billing model in the original supports real tenant isolation (no `tenantId` anywhere). Building single-tenant first, tenant-scoping added as an explicit Phase 5 migration, not retrofitted silently |
| User vs Subscriber | original conflates "User Management" (admin-side subscriber CRUD) with "User Portal" (customer identity) | Split in schema: `User` = auth/login identity (any role, incl. `CUSTOMER`), `Subscriber` = the ISP service account. A `User` with role `CUSTOMER` has exactly one `Subscriber` |
| Money type | unspecified | Integer kobo (NGN minor unit) everywhere. Never float. Prevents the classic billing rounding-error class of bugs |
| GPON OLT vendors | "possible vendors" listed, no protocol chosen | Defer vendor-specific OLT driver work — build the `NetworkDevice` abstraction first, vendor adapters plug in behind it later |

## 2. Module → RBAC → DB ownership matrix

Original listed modules and roles in separate sections with no mapping between
them. This is the missing link — each module's controller uses `@Roles(...)`
guarding writes; reads are broader per role.

| Module | Owns tables | Write roles |
|---|---|---|
| Auth | `User`, sessions | self-service + `SUPER_ADMIN` |
| Users | `User` | `SUPER_ADMIN`, `OPERATIONS_MANAGER` |
| Subscriptions | `Subscriber`, `Plan`, `Subscription` | `SALES_AGENT` (create), `OPERATIONS_MANAGER` (plans) |
| Billing | `Invoice`, `InvoiceLine` | `BILLING_OFFICER` |
| Payments | `Payment` | `BILLING_OFFICER` + webhook-only writes from provider callbacks |
| Tickets | `Ticket` | `CUSTOMER_SUPPORT`, subscriber (own tickets only) |
| Network / NOC | `NetworkDevice`, `Cpe` | `NOC_ENGINEER` |
| Inventory | `InventoryItem` | `OPERATIONS_MANAGER`, `FIELD_ENGINEER` (consume only) |
| CRM | `Contract` | `SALES_AGENT`, `CUSTOMER_SUPPORT` |
| Reports | read-only aggregation across all | `CEO` (read-all), `OPERATIONS_MANAGER` |

`SUPER_ADMIN` bypasses all guards. `CEO` is read-only across every module —
enforce this at the guard level (`@Roles` on `@Get()` only, never on
mutating verbs), not by convention.

**NOTE (deviation):** The actual codebase also uses two roles not listed in this spec:
`FINANCE_MANAGER` (used in Payments module for refunds and reconciliation) and
`CUSTOMER` (used in Tickets for subscriber ticket creation). These are additive
— no spec role was removed. If they should be removed, a full role-usage audit
is needed first.

## 3. Billing state machine (unstated in original)

```
DRAFT → ISSUED → PAID
              ↘ OVERDUE → PAID
              ↘ VOID
```

- `ISSUED → PAID` only via a confirmed `Payment.status = SUCCESSFUL` webhook, never a direct admin write. Prevents an admin fat-fingering revenue state.
- Suspension job (BullMQ, per original "Scheduled Suspension") fires when `Invoice.status = OVERDUE` past a configurable grace period, not immediately on due date.

## 4. Auth (original said "JWT, Refresh Tokens, 2FA, OAuth" — no flow)

- Access token: 15 min, JWT, `Bearer`.
- Refresh token: 7 days, httpOnly cookie, rotated on use (reject reuse — replay detection).
- 2FA: TOTP (RFC 6238), enforced for all staff roles at login, optional for `CUSTOMER`.
- OAuth: deferred to Phase 3, no provider specified in original — do not build against a guess.

## 5. Phasing (original had no delivery order — build order matters here)

1. **Phase 1 — Core**: Auth, Users, Subscriptions, Plans. No billing yet — nothing to bill without subscribers.
2. **Phase 2 — Money**: Billing, Payments (Paystack first — largest NG market share, others behind the same provider interface), invoice generation job.
3. **Phase 3 — Ops**: Tickets, Network/NOC device status (polling, not yet real-time push), Inventory.
4. **Phase 4 — Scale**: Read replicas, Redis caching layer, real-time NOC via WebSocket/MQTT from RouterOS API, GraphQL gateway if still justified by client needs.
5. **Phase 5 — Multi-tenant, AI features**: Only after single-tenant is in production. Do not parallelize with Phase 1–3.

## 5b. Accepted extensions (not in original spec, implemented and stable)

### Subscription-level override fields

`Subscription` model carries optional per-subscription overrides for plan defaults:
- `installationFeeKobo Int?` — overrides `Plan.installationFeeKobo` for this subscriber
- `routerProvided Boolean?` — overrides `Plan.routerIncluded`
- `routerCostKobo Int?` — cost of router if provided (separate from installation fee)

These are set during customer creation (`POST /subscriptions/:id/subscriptions`)
and stored alongside the subscription. They are **not** used by the invoice
generation job yet — that's future work.

### Wallet, WalletTransaction, VirtualAccount

Three models in the Payments domain not in the original spec:

| Model | Purpose |
|---|---|
| `Wallet` | Per-subscriber wallet balance (`balanceKobo`). One-to-one with `Subscriber`. |
| `WalletTransaction` | Audit log of all wallet movements: CREDIT, DEBIT, PAYMENT, REFUND, PROMO, ADJUSTMENT. |
| `VirtualAccount` | Assigned bank account per subscriber per provider (e.g., Paystack dedicated NUBAN). |

Endpoints under `POST /payments/wallet/:subscriberId/*` and
`POST /payments/virtual-accounts/:subscriberId/*`. Wallet can pay invoices
via `POST /payments/pay-with-wallet/:invoiceId`.

Removing these would be a data-loss operation — escalate to human if deletion
is desired.

## 6. Non-functional targets (original: "enterprise-grade", "real-time" — not testable)

- API p95 latency < 300ms for reads, < 800ms for writes (invoice generation excluded — async job).
- Uptime target 99.9% for MVP (99.99% in original is a Phase 4+ SLA target once read replicas + multi-AZ exist — committing to 99.99% on a single Postgres instance is not credible).
- NOC device status considered stale and flagged after 90s without a poll response.

## 7. What was cut from the original as premature

- Mobile apps (React Native) — Phase 4+, after web APIs stabilize.
- AI features section — kept as backlog, not scoped; each item (churn prediction, fraud detection) needs its own spec with a labeled dataset, which doesn't exist yet.
- "GraphQL Gateway" as a bullet under API Optimization while the rest of the doc is REST-only — resolved in §1.

## 8. Repo layout delivered

```
isp-platform/
├── apps/
│   ├── api/            NestJS — modules per domain, Prisma ORM
│   ├── admin/           Next.js 15 admin portal
│   └── customer/         Next.js 15 customer portal
├── packages/shared/       shared types/DTOs between apps
├── infra/                 nginx, prometheus config
├── docker-compose.yml      postgres, redis, minio, api, admin, customer, prometheus, grafana
├── .env.example
└── docs/refined-spec.md    this file
```

Each `apps/api/src/modules/<name>` has `module.ts` / `controller.ts` /
`service.ts` stubs wired into `app.module.ts`, matching §2's table. Prisma
schema at `apps/api/prisma/schema.prisma` implements §1's data model
decisions directly — models, enums, and indexes are the actual contract now,
not prose.

## 9. Next concrete steps

1. `pnpm install` at repo root.
2. `docker compose up -d postgres redis minio`
3. `cp .env.example .env` and fill secrets.
4. `pnpm prisma:migrate` — creates schema from `schema.prisma`.
5. Implement `auth` module fully (bcrypt hashing, JWT issuance, refresh rotation) before touching any other module — everything else guards on it.
