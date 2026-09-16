# Alpine base — ~50MB vs 150MB bookworm, musl compatible (Prisma already targets linux-musl-openssl-3.0.x)
FROM node:24-alpine AS base
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo

# ---- deps: install once, cached unless pnpm-lock changes ----
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/api/package.json apps/api/package.json
COPY apps/auth-service/package.json apps/auth-service/package.json
COPY apps/payments-service/package.json apps/payments-service/package.json
COPY apps/billing-service/package.json apps/billing-service/package.json
COPY apps/support-service/package.json apps/support-service/package.json
COPY apps/customer-service/package.json apps/customer-service/package.json
COPY apps/radius-service/package.json apps/radius-service/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/customer/package.json apps/customer/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build: compile all workspaces (Nest + Next) ----
FROM deps AS build
COPY apps/api ./apps/api
COPY apps/auth-service ./apps/auth-service
COPY apps/payments-service ./apps/payments-service
COPY apps/billing-service ./apps/billing-service
COPY apps/support-service ./apps/support-service
COPY apps/customer-service ./apps/customer-service
COPY apps/radius-service ./apps/radius-service
COPY apps/admin ./apps/admin
COPY apps/customer ./apps/customer
# Public build-time vars for the Next.js apps (same-origin API via nginx in prod)
ARG NEXT_PUBLIC_API_URL=/api/v1
ARG NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=$NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm --filter api prisma:generate \
 && pnpm --filter api build \
 && pnpm --filter auth-service build \
 && pnpm --filter payments-service build \
 && pnpm --filter billing-service build \
 && pnpm --filter support-service build \
 && pnpm --filter customer-service build \
 && pnpm --filter radius-service build \
 && pnpm --filter admin build \
 && pnpm --filter customer build

# ---- pruned: prod-only for deploy ----
FROM build AS pruned
RUN pnpm prune --prod

# ---- deploy: per-service minimal prod deployments (pnpm deploy) ----
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
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
CMD ["sh", "-c", "cd apps/api && npx prisma migrate resolve --rolled-back \"20260916300000_batch7_perf\" || true && npx prisma migrate deploy && npx tsx prisma/seed-prod.ts"]

# ---- backend: api (gateway) — needs radclient ----
FROM base AS runtime-api
RUN apk add --no-cache freeradius freeradius-utils
WORKDIR /repo
COPY --from=deploy-api /deploy/api/node_modules ./node_modules
COPY --from=deploy-api /deploy/api/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

# ---- backend: auth ----
FROM base AS runtime-auth
WORKDIR /repo
COPY --from=deploy-auth /deploy/auth/node_modules ./node_modules
COPY --from=deploy-auth /deploy/auth/package.json ./package.json
COPY --from=build /repo/apps/auth-service/dist ./apps/auth-service/dist
COPY --from=build /repo/apps/auth-service/package.json ./apps/auth-service/package.json
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
EXPOSE 4101
CMD ["node", "apps/auth-service/dist/main.js"]

# ---- backend: payments ----
FROM base AS runtime-payments
WORKDIR /repo
COPY --from=deploy-payments /deploy/payments/node_modules ./node_modules
COPY --from=deploy-payments /deploy/payments/package.json ./package.json
COPY --from=build /repo/apps/payments-service/dist ./apps/payments-service/dist
COPY --from=build /repo/apps/payments-service/package.json ./apps/payments-service/package.json
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
EXPOSE 4102
CMD ["node", "apps/payments-service/dist/main.js"]

# ---- backend: billing ----
FROM base AS runtime-billing
WORKDIR /repo
COPY --from=deploy-billing /deploy/billing/node_modules ./node_modules
COPY --from=deploy-billing /deploy/billing/package.json ./package.json
COPY --from=build /repo/apps/billing-service/dist ./apps/billing-service/dist
COPY --from=build /repo/apps/billing-service/package.json ./apps/billing-service/package.json
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
EXPOSE 4103
CMD ["node", "apps/billing-service/dist/main.js"]

# ---- backend: support ----
FROM base AS runtime-support
WORKDIR /repo
COPY --from=deploy-support /deploy/support/node_modules ./node_modules
COPY --from=deploy-support /deploy/support/package.json ./package.json
COPY --from=build /repo/apps/support-service/dist ./apps/support-service/dist
COPY --from=build /repo/apps/support-service/package.json ./apps/support-service/package.json
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
EXPOSE 4104
CMD ["node", "apps/support-service/dist/main.js"]

# ---- backend: customer-service ----
FROM base AS runtime-customer-svc
WORKDIR /repo
COPY --from=deploy-customer-svc /deploy/customer-svc/node_modules ./node_modules
COPY --from=deploy-customer-svc /deploy/customer-svc/package.json ./package.json
COPY --from=build /repo/apps/customer-service/dist ./apps/customer-service/dist
COPY --from=build /repo/apps/customer-service/package.json ./apps/customer-service/package.json
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
EXPOSE 4105
CMD ["node", "apps/customer-service/dist/main.js"]

# ---- backend: radius ----
FROM base AS runtime-radius
RUN apk add --no-cache freeradius freeradius-utils
WORKDIR /repo
COPY --from=deploy-radius /deploy/radius/node_modules ./node_modules
COPY --from=deploy-radius /deploy/radius/package.json ./package.json
COPY --from=build /repo/apps/radius-service/dist ./apps/radius-service/dist
COPY --from=build /repo/apps/radius-service/package.json ./apps/radius-service/package.json
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
EXPOSE 4106
CMD ["node", "apps/radius-service/dist/main.js"]

# ---- generic service fallback (for compose with ARG SERVICE) ----
FROM base AS runtime-service
ARG SERVICE
WORKDIR /repo
COPY --from=pruned /repo/node_modules ./node_modules
COPY --from=pruned /repo/packages ./packages
COPY --from=build /repo/apps/${SERVICE}/dist ./apps/${SERVICE}/dist
COPY --from=build /repo/apps/${SERVICE}/package.json ./apps/${SERVICE}/package.json
COPY --from=build /repo/apps/${SERVICE}/node_modules ./apps/${SERVICE}/node_modules
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
EXPOSE 4101 4102 4103 4104 4105 4106
CMD ["sh", "-c", "node apps/${SERVICE}/dist/main.js"]

# ---- frontend: admin (Next.js standalone) ----
FROM base AS runtime-admin
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/apps/admin/.next/standalone ./
COPY --from=build /repo/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build /repo/apps/admin/public ./apps/admin/public
WORKDIR /repo/apps/admin
EXPOSE 3000
CMD ["node", "server.js"]

# ---- frontend: customer (Next.js standalone) ----
FROM base AS runtime-customer
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/apps/customer/.next/standalone ./
COPY --from=build /repo/apps/customer/.next/static ./apps/customer/.next/static
COPY --from=build /repo/apps/customer/public ./apps/customer/public
WORKDIR /repo/apps/customer
EXPOSE 3000
CMD ["node", "server.js"]

# ---- fallback: legacy monolith (not used) ----
FROM base AS runtime
RUN apk add --no-cache freeradius freeradius-utils
WORKDIR /repo
COPY --from=pruned /repo/node_modules ./node_modules
COPY --from=pruned /repo/packages ./packages
COPY --from=pruned /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=pruned /repo/apps/auth-service/node_modules ./apps/auth-service/node_modules
COPY --from=pruned /repo/apps/payments-service/node_modules ./apps/payments-service/node_modules
COPY --from=pruned /repo/apps/billing-service/node_modules ./apps/billing-service/node_modules
COPY --from=pruned /repo/apps/support-service/node_modules ./apps/support-service/node_modules
COPY --from=pruned /repo/apps/customer-service/node_modules ./apps/customer-service/node_modules
COPY --from=pruned /repo/apps/radius-service/node_modules ./apps/radius-service/node_modules
COPY --from=build /repo/apps/admin/.next ./apps/admin/.next
COPY --from=build /repo/apps/customer/.next ./apps/customer/.next
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/auth-service/dist ./apps/auth-service/dist
COPY --from=build /repo/apps/payments-service/dist ./apps/payments-service/dist
COPY --from=build /repo/apps/billing-service/dist ./apps/billing-service/dist
COPY --from=build /repo/apps/support-service/dist ./apps/support-service/dist
COPY --from=build /repo/apps/customer-service/dist ./apps/customer-service/dist
COPY --from=build /repo/apps/radius-service/dist ./apps/radius-service/dist
EXPOSE 4000 4101 4102 4103 4104 4105 4106 3000 3001
CMD ["node", "apps/api/dist/main.js"]
