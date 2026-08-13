# ISP Management Platform

Monorepo scaffold. See `docs/refined-spec.md` for the precision pass on the
original spec (decisions, RBAC↔DB matrix, billing state machine, phasing).

## Quick start
```bash
pnpm install
docker compose up -d postgres redis minio
cp .env.example .env   # fill secrets
pnpm prisma:migrate
pnpm dev
```

## Layout
- `apps/api` — NestJS backend, one module per domain (see `src/modules`)
- `apps/admin` — Next.js 15 admin portal, runs on :3001
- `apps/customer` — Next.js 15 customer portal, runs on :3000
- `packages/shared` — cross-app types/DTOs
- `infra/` — nginx + prometheus config

## Frontend

Two design systems, one platform — deliberately different registers for
different users:

- **Admin ("Signal Room")** — dark, dense, mono-numeric. Built for staff
  staring at it all day: subscribers, NOC device grid, billing, tickets,
  reports. Pages under `apps/admin/src/app/(dashboard)/`.
- **Customer ("Fiber Home")** — light, calm, one question answered fast
  ("is my internet working, what do I owe"). Hero is a cycle-progress usage
  gauge, not a data-cap warning (plans here are unlimited). Pages under
  `apps/customer/src/app/(portal)/`.

Both currently read from `src/lib/mock-data.ts` (shaped exactly like the
Prisma models) so the UI is reviewable without the API running. Swap those
imports for real `fetch('/api/v1/...')` calls once `auth` + the relevant
backend module are implemented — the shapes already match.

```bash
pnpm --filter admin dev      # http://localhost:3001
pnpm --filter customer dev   # http://localhost:3000
```
