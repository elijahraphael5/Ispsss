import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { PrismaModule } from './common/prisma/prisma.module';
import { CacheModule } from './common/cache/cache.module';
import { JwtAuthModule } from './common/auth/jwt-auth.module';
import { UsersModule } from './modules/users/users.module';
import { NetworkModule } from './modules/network/network.module';
import { RouterOsModule } from './modules/routeros/routeros.module';
import { NocModule } from './modules/noc/noc.module';
import { ReportsModule } from './modules/reports/reports.module';
import { CustomRolesModule } from './modules/custom-roles/custom-roles.module';
import { CoverageAreasModule } from './modules/coverage-areas/coverage-areas.module';
import { CoverageZonesModule } from './modules/coverage-zones/coverage-zones.module';
import { TenantSettingsModule } from './modules/tenant-settings/tenant-settings.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OwnerModule } from './owner/owner.module';
import { AdminModule } from './modules/admin/admin.module';
import { RouterHealthModule } from './modules/router-health/router-health.module';
import { SnapshotsModule } from './modules/snapshots/snapshots.module';
import { JobsModule } from './jobs/jobs.module';
import { MailModule } from './modules/mail/mail.module';
import { GatewayModule } from './gateway/gateway.module';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

@Module({
  imports: [
    PrismaModule,
    CacheModule,
    JwtAuthModule,
    ...(redisUrl === 'none' ? [] : [BullModule.forRoot({ connection: { url: redisUrl } })]),
    ConfigModule.forRoot({ isGlobal: true }),
    UsersModule,
    NetworkModule,
    RouterOsModule,
    NocModule,
    AuditLogsModule,
    ReportsModule,
    CustomRolesModule,
    CoverageAreasModule,
    CoverageZonesModule,
    TenantSettingsModule,
    NotificationsModule,
    OwnerModule,
    AdminModule,
    MailModule,
    RouterHealthModule,
    SnapshotsModule,
    GatewayModule,
    ...(redisUrl === 'none' ? [] : [JobsModule]),
  ],
})
export class AppModule {}
