FROM node:24-bullseye-slim AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo

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
RUN pnpm install --frozen-lockfile

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
RUN pnpm --filter api prisma:generate \
 && pnpm --filter api build \
 && pnpm --filter auth-service build \
 && pnpm --filter payments-service build \
 && pnpm --filter billing-service build \
 && pnpm --filter support-service build \
 && pnpm --filter customer-service build \
 && pnpm --filter radius-service build \
 && pnpm --filter admin build \
 && pnpm --filter customer build

FROM base AS runtime
ENV NODE_ENV=production
# radclient/radtest for CoA/disconnect + integration verification
RUN apt-get update && apt-get install -y --no-install-recommends freeradius-utils \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/auth-service/node_modules ./apps/auth-service/node_modules
COPY --from=build /repo/apps/payments-service/node_modules ./apps/payments-service/node_modules
COPY --from=build /repo/apps/billing-service/node_modules ./apps/billing-service/node_modules
COPY --from=build /repo/apps/support-service/node_modules ./apps/support-service/node_modules
COPY --from=build /repo/apps/customer-service/node_modules ./apps/customer-service/node_modules
COPY --from=build /repo/apps/radius-service/node_modules ./apps/radius-service/node_modules
COPY --from=build /repo/apps/admin/node_modules ./apps/admin/node_modules
COPY --from=build /repo/apps/customer/node_modules ./apps/customer/node_modules
COPY --from=build /repo/packages ./packages
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
COPY --from=build /repo/apps/auth-service/.env ./apps/auth-service/.env
COPY --from=build /repo/apps/payments-service/.env ./apps/payments-service/.env
COPY --from=build /repo/apps/billing-service/.env ./apps/billing-service/.env
COPY --from=build /repo/apps/support-service/.env ./apps/support-service/.env
COPY --from=build /repo/apps/api/.env ./.env
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
EXPOSE 4000 4101 4102 4103 4104 4105 4106 3000 3001
CMD ["node", "apps/api/dist/main.js"]