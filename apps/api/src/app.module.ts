import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';

import { TenantModule } from './common/tenant/tenant.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { BillingModule } from './modules/billing/billing.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { NetworkModule } from './modules/network/network.module';
import { RouterOsModule } from './modules/routeros/routeros.module';
import { NocModule } from './modules/noc/noc.module';
import { CrmModule } from './modules/crm/crm.module';
import { ReportsModule } from './modules/reports/reports.module';
import { CustomRolesModule } from './modules/custom-roles/custom-roles.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OwnerModule } from './owner/owner.module';
import { AdminModule } from './modules/admin/admin.module';
import { CustomerModule } from './modules/customer/customer.module';
import { SupportModule } from './modules/support/support.module';
import { RouterHealthModule } from './modules/router-health/router-health.module';
import { JobsModule } from './jobs/jobs.module';
import { MailModule } from './modules/mail/mail.module';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

@Module({
  imports: [
    PrismaModule,
    TenantModule,
    ...(redisUrl === 'none' ? [] : [BullModule.forRoot({ connection: { url: redisUrl } })]),
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    AuthModule,
    UsersModule,
    SubscriptionsModule,
    BillingModule,
    PaymentsModule,
    NetworkModule,
    RouterOsModule,
    NocModule,
    AuditLogsModule,
    CrmModule,
    ReportsModule,
    CustomRolesModule,
    NotificationsModule,
    OwnerModule,
    AdminModule,
    CustomerModule,
    SupportModule,
    MailModule,
    RouterHealthModule,
    ...(redisUrl === 'none' ? [] : [JobsModule]),
  ],
})
export class AppModule {}
