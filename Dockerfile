FROM node:24.11-bookworm-slim AS base
# openssl CLI so Prisma detects debian-openssl-3.0.x (bookworm ships libssl3;
# without the CLI Prisma defaults to openssl-1.1.x and the engine fails to load)
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
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

# ---- pruned: prod-only node_modules for lean runtimes ----
# Keep build's full node_modules for init (needs prisma + tsx), prune here for all other runtimes
FROM build AS pruned
RUN pnpm prune --prod

# ---- shared lean base (no freeradius-utils, no dev deps) ----
FROM base AS runtime-base
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=pruned /repo/packages ./packages
COPY --from=pruned /repo/node_modules ./node_modules

# ---- init: one-shot migrator/seeder — needs full deps (prisma + tsx) ----
FROM base AS runtime-init
ENV NODE_ENV=production
WORKDIR /repo
# full node_modules from build (keeps prisma, tsx, typescript)
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
CMD ["sh", "-c", "cd apps/api && npx prisma migrate resolve --rolled-back \"20260916300000_batch7_perf\" || true && npx prisma migrate deploy && npx tsx prisma/seed-prod.ts"]

# ---- backend: api (gateway) — needs freeradius-utils for CoA probes ----
FROM runtime-base AS runtime-api
RUN apt-get update && apt-get install -y --no-install-recommends freeradius-utils \
 && rm -rf /var/lib/apt/lists/*
COPY --from=pruned /repo/apps/api/dist ./apps/api/dist
COPY --from=pruned /repo/apps/api/package.json ./apps/api/package.json
COPY --from=pruned /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

# ---- backend: generic microservice (reused via --build-arg SERVICE) ----
FROM runtime-base AS runtime-service
ARG SERVICE
COPY --from=pruned /repo/apps/${SERVICE}/dist ./apps/${SERVICE}/dist
COPY --from=pruned /repo/apps/${SERVICE}/package.json ./apps/${SERVICE}/package.json
COPY --from=pruned /repo/apps/${SERVICE}/node_modules ./apps/${SERVICE}/node_modules
# COPY prisma schema for services that import @prisma/client at runtime (all do via @isp/prisma)
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
EXPOSE 4101 4102 4103 4104 4105 4106
CMD ["sh", "-c", "node apps/${SERVICE}/dist/main.js"]

# ---- backend: radius (needs freeradius-utils for radclient) ----
FROM runtime-base AS runtime-radius
RUN apt-get update && apt-get install -y --no-install-recommends freeradius-utils \
 && rm -rf /var/lib/apt/lists/*
COPY --from=pruned /repo/apps/radius-service/dist ./apps/radius-service/dist
COPY --from=pruned /repo/apps/radius-service/package.json ./apps/radius-service/package.json
COPY --from=pruned /repo/apps/radius-service/node_modules ./apps/radius-service/node_modules
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
EXPOSE 4106
CMD ["node", "apps/radius-service/dist/main.js"]

# ---- frontend: admin ----
FROM runtime-base AS runtime-admin
COPY --from=pruned /repo/apps/admin/node_modules ./apps/admin/node_modules
COPY --from=build /repo/apps/admin/.next ./apps/admin/.next
COPY --from=build /repo/apps/admin/package.json ./apps/admin/package.json
COPY --from=build /repo/apps/admin/next.config.js ./apps/admin/next.config.js
COPY --from=build /repo/apps/admin/public ./apps/admin/public
WORKDIR /repo/apps/admin
EXPOSE 3000
CMD ["sh", "-c", "exec ./node_modules/.bin/next start -p 3000"]

# ---- frontend: customer ----
FROM runtime-base AS runtime-customer
COPY --from=pruned /repo/apps/customer/node_modules ./apps/customer/node_modules
COPY --from=build /repo/apps/customer/.next ./apps/customer/.next
COPY --from=build /repo/apps/customer/package.json ./apps/customer/package.json
COPY --from=build /repo/apps/customer/next.config.js ./apps/customer/next.config.js
COPY --from=build /repo/apps/customer/public ./apps/customer/public
WORKDIR /repo/apps/customer
EXPOSE 3000
CMD ["sh", "-c", "exec ./node_modules/.bin/next start -p 3000"]

# ---- fallback: legacy monolith runtime (kept for backward compat, not used in compose) ----
FROM runtime-base AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends freeradius-utils \
 && rm -rf /var/lib/apt/lists/*
COPY --from=pruned /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=pruned /repo/apps/auth-service/node_modules ./apps/auth-service/node_modules
COPY --from=pruned /repo/apps/payments-service/node_modules ./apps/payments-service/node_modules
COPY --from=pruned /repo/apps/billing-service/node_modules ./apps/billing-service/node_modules
COPY --from=pruned /repo/apps/support-service/node_modules ./apps/support-service/node_modules
COPY --from=pruned /repo/apps/customer-service/node_modules ./apps/customer-service/node_modules
COPY --from=pruned /repo/apps/radius-service/node_modules ./apps/radius-service/node_modules
COPY --from=pruned /repo/apps/admin/node_modules ./apps/admin/node_modules
COPY --from=pruned /repo/apps/customer/node_modules ./apps/customer/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/auth-service/dist ./apps/auth-service/dist
COPY --from=build /repo/apps/payments-service/dist ./apps/payments-service/dist
COPY --from=build /repo/apps/billing-service/dist ./apps/billing-service/dist
COPY --from=build /repo/apps/support-service/dist ./apps/support-service/dist
COPY --from=build /repo/apps/customer-service/dist ./apps/customer-service/dist
COPY --from=build /repo/apps/radius-service/dist ./apps/radius-service/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/auth-service/package.json ./apps/auth-service/package.json
COPY --from=build /repo/apps/payments-service/package.json ./apps/payments-service/package.json
COPY --from=build /repo/apps/billing-service/package.json ./apps/billing-service/package.json
COPY --from=build /repo/apps/support-service/package.json ./apps/support-service/package.json
COPY --from=build /repo/apps/customer-service/package.json ./apps/customer-service/package.json
COPY --from=build /repo/apps/radius-service/package.json ./apps/radius-service/package.json
COPY --from=build /repo/apps/admin/.next ./apps/admin/.next
COPY --from=build /repo/apps/admin/package.json ./apps/admin/package.json
COPY --from=build /repo/apps/admin/next.config.js ./apps/admin/next.config.js
COPY --from=build /repo/apps/admin/public ./apps/admin/public
COPY --from=build /repo/apps/customer/.next ./apps/customer/.next
COPY --from=build /repo/apps/customer/package.json ./apps/customer/package.json
COPY --from=build /repo/apps/customer/next.config.js ./apps/customer/next.config.js
COPY --from=build /repo/apps/customer/public ./apps/customer/public
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
WORKDIR /repo
EXPOSE 4000 4101 4102 4103 4104 4105 4106 3000 3001
CMD ["node", "apps/api/dist/main.js"]
