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
- `apps/admin` — Next.js 15 admin portal
- `apps/customer` — Next.js 15 customer portal
- `packages/shared` — cross-app types/DTOs
- `infra/` — nginx + prometheus config
