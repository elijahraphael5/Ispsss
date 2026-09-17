# Alpine base — 50MB vs 150MB bookworm, musl compatible (Prisma already targets linux-musl-openssl-3.0.x)
FROM node:24-alpine AS base
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo
ENV TURBO_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/root/.local/share/pnpm

# ---- pruner: create minimal workspace for prod scopes (turbo prune) ----
FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo prune api auth-service payments-service billing-service support-service customer-service radius-service admin customer --docker

# ---- installer: fetch deps once, cached unless lock changes (ultra-fast fresh deploy) ----
FROM base AS installer
WORKDIR /app
# pnpm fetch needs only pnpm-lock + package.jsons (from pruner json)
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm fetch
# now copy full pruned source and install offline (no network)
COPY --from=pruner /app/out/full/ .
COPY turbo.json ./turbo.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --offline --frozen-lockfile

# ---- builder: compile all workspaces (uses turbo cache) ----
FROM installer AS builder
WORKDIR /app
# Public build-time vars for Next.js (baked)
ARG NEXT_PUBLIC_API_URL=/api/v1
ARG NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=$NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    --mount=type=cache,target=/app/.turbo \
    pnpm --filter api prisma:generate \
 && pnpm turbo run build --filter=api --filter=auth-service --filter=payments-service --filter=billing-service --filter=support-service --filter=customer-service --filter=radius-service --filter=admin --filter=customer

# ---- pruned: prod-only for deploy (keep for fallback) ----
FROM builder AS pruned
RUN pnpm prune --prod

# ---- deploy: per-service minimal prod (pnpm deploy) — true lean ----
FROM pruned AS deploy-api
RUN pnpm --filter api deploy --prod /deploy/api

FROM pruned AS deploy-auth
RUN pnpm --filter auth-service deploy --prod /deploy/auth

FROM pruned AS deploy-payments
RUN pnpm --filter payments-service deploy --prod /deploy/payments

FROM pruned AS deploy-billing
RUN pnpm --filter billing-service deploy --prod /deploy/billing

FROM pruned AS deploy-support
RUN pnpm --filter support-service deploy --prod /deploy/support

FROM pruned AS deploy-customer-svc
RUN pnpm --filter customer-service deploy --prod /deploy/customer-svc

FROM pruned AS deploy-radius
RUN pnpm --filter radius-service deploy --prod /deploy/radius

# ---- init: one-shot migrator/seeder — needs full deps (prisma + tsx) ----
FROM base AS runtime-init
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
CMD ["sh", "-c", "cd apps/api && npx prisma migrate resolve --rolled-back \"20260916300000_batch7_perf\" 2>/dev/null || true && npx prisma migrate deploy && npx tsx prisma/seed-prod.ts"]

# ---- backend: api (gateway) — needs radclient ----
FROM base AS runtime-api
RUN apk add --no-cache freeradius freeradius-utils
WORKDIR /repo
COPY --from=deploy-api /deploy/api/node_modules ./node_modules
COPY --from=deploy-api /deploy/api/package.json ./package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

# ---- backend: auth ----
FROM base AS runtime-auth
WORKDIR /repo
COPY --from=deploy-auth /deploy/auth/node_modules ./node_modules
COPY --from=deploy-auth /deploy/auth/package.json ./package.json
COPY --from=builder /app/apps/auth-service/dist ./apps/auth-service/dist
COPY --from=builder /app/apps/auth-service/package.json ./apps/auth-service/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
EXPOSE 4101
CMD ["node", "apps/auth-service/dist/main.js"]

# ---- backend: payments ----
FROM base AS runtime-payments
WORKDIR /repo
COPY --from=deploy-payments /deploy/payments/node_modules ./node_modules
COPY --from=deploy-payments /deploy/payments/package.json ./package.json
COPY --from=builder /app/apps/payments-service/dist ./apps/payments-service/dist
COPY --from=builder /app/apps/payments-service/package.json ./apps/payments-service/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
EXPOSE 4102
CMD ["node", "apps/payments-service/dist/main.js"]

# ---- backend: billing ----
FROM base AS runtime-billing
WORKDIR /repo
COPY --from=deploy-billing /deploy/billing/node_modules ./node_modules
COPY --from=deploy-billing /deploy/billing/package.json ./package.json
COPY --from=builder /app/apps/billing-service/dist ./apps/billing-service/dist
COPY --from=builder /app/apps/billing-service/package.json ./apps/billing-service/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
EXPOSE 4103
CMD ["node", "apps/billing-service/dist/main.js"]

# ---- backend: support ----
FROM base AS runtime-support
WORKDIR /repo
COPY --from=deploy-support /deploy/support/node_modules ./node_modules
COPY --from=deploy-support /deploy/support/package.json ./package.json
COPY --from=builder /app/apps/support-service/dist ./apps/support-service/dist
COPY --from=builder /app/apps/support-service/package.json ./apps/support-service/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
EXPOSE 4104
CMD ["node", "apps/support-service/dist/main.js"]

# ---- backend: customer-service ----
FROM base AS runtime-customer-svc
WORKDIR /repo
COPY --from=deploy-customer-svc /deploy/customer-svc/node_modules ./node_modules
COPY --from=deploy-customer-svc /deploy/customer-svc/package.json ./package.json
COPY --from=builder /app/apps/customer-service/dist ./apps/customer-service/dist
COPY --from=builder /app/apps/customer-service/package.json ./apps/customer-service/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
EXPOSE 4105
CMD ["node", "apps/customer-service/dist/main.js"]

# ---- backend: radius ----
FROM base AS runtime-radius
RUN apk add --no-cache freeradius freeradius-utils
WORKDIR /repo
COPY --from=deploy-radius /deploy/radius/node_modules ./node_modules
COPY --from=deploy-radius /deploy/radius/package.json ./package.json
COPY --from=builder /app/apps/radius-service/dist ./apps/radius-service/dist
COPY --from=builder /app/apps/radius-service/package.json ./apps/radius-service/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
EXPOSE 4106
CMD ["node", "apps/radius-service/dist/main.js"]

# ---- generic service fallback (for compose with ARG SERVICE) ----
FROM base AS runtime-service
ARG SERVICE
WORKDIR /repo
COPY --from=pruned /app/node_modules ./node_modules
COPY --from=pruned /app/packages ./packages
COPY --from=builder /app/apps/${SERVICE}/dist ./apps/${SERVICE}/dist
COPY --from=builder /app/apps/${SERVICE}/package.json ./apps/${SERVICE}/package.json
COPY --from=builder /app/apps/${SERVICE}/node_modules ./apps/${SERVICE}/node_modules
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
EXPOSE 4101 4102 4103 4104 4105 4106
CMD ["sh", "-c", "node apps/${SERVICE}/dist/main.js"]

# ---- frontend: admin (Next.js standalone) ----
FROM base AS runtime-admin
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=builder /app/apps/admin/.next/standalone ./
COPY --from=builder /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=builder /app/apps/admin/public ./apps/admin/public
WORKDIR /repo/apps/admin
EXPOSE 3000
CMD ["node", "server.js"]

# ---- frontend: customer (Next.js standalone) ----
FROM base AS runtime-customer
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=builder /app/apps/customer/.next/standalone ./
COPY --from=builder /app/apps/customer/.next/static ./apps/customer/.next/static
COPY --from=builder /app/apps/customer/public ./apps/customer/public
WORKDIR /repo/apps/customer
EXPOSE 3000
CMD ["node", "server.js"]

# ---- fallback: legacy monolith (not used) ----
FROM base AS runtime
RUN apk add --no-cache freeradius freeradius-utils
WORKDIR /repo
COPY --from=pruned /app/node_modules ./node_modules
COPY --from=pruned /app/packages ./packages
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/auth-service/dist ./apps/auth-service/dist
COPY --from=builder /app/apps/payments-service/dist ./apps/payments-service/dist
COPY --from=builder /app/apps/billing-service/dist ./apps/billing-service/dist
COPY --from=builder /app/apps/support-service/dist ./apps/support-service/dist
COPY --from=builder /app/apps/customer-service/dist ./apps/customer-service/dist
COPY --from=builder /app/apps/radius-service/dist ./apps/radius-service/dist
EXPOSE 4000 4101 4102 4103 4104 4105 4106 3000 3001
CMD ["node", "apps/api/dist/main.js"]
