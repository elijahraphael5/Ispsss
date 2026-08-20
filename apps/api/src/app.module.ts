import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';

import { TenantModule } from './common/tenant/tenant.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { JwtAuthModule } from './common/auth/jwt-auth.module';
import { UsersModule } from './modules/users/users.module';
import { NetworkModule } from './modules/network/network.module';
import { RouterOsModule } from './modules/routeros/routeros.module';
import { NocModule } from './modules/noc/noc.module';
import { ReportsModule } from './modules/reports/reports.module';
import { CustomRolesModule } from './modules/custom-roles/custom-roles.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OwnerModule } from './owner/owner.module';
import { AdminModule } from './modules/admin/admin.module';
import { RouterHealthModule } from './modules/router-health/router-health.module';
import { JobsModule } from './jobs/jobs.module';
import { MailModule } from './modules/mail/mail.module';
import { GatewayModule } from './gateway/gateway.module';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

@Module({
  imports: [
    PrismaModule,
    TenantModule,
    JwtAuthModule,
    ...(redisUrl === 'none' ? [] : [BullModule.forRoot({ connection: { url: redisUrl } })]),
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      { ttl: Number(process.env.THROTTLE_TTL_MS ?? 60000), limit: Number(process.env.THROTTLE_LIMIT ?? 100) },
    ]),
    UsersModule,
    NetworkModule,
    RouterOsModule,
    NocModule,
    AuditLogsModule,
    ReportsModule,
    CustomRolesModule,
    NotificationsModule,
    OwnerModule,
    AdminModule,
    MailModule,
    RouterHealthModule,
    GatewayModule,
    ...(redisUrl === 'none' ? [] : [JobsModule]),
  ],
})
export class AppModule {}
