import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TenantModule } from './common/tenant/tenant.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { JwtAuthModule } from './common/auth/jwt-auth.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MailModule } from './modules/mail/mail.module';
import { CustomerModule } from './modules/customer/customer.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { CrmModule } from './modules/crm/crm.module';

@Module({
  imports: [
    PrismaModule,
    TenantModule,
    JwtAuthModule,
    ConfigModule.forRoot({ isGlobal: true, envFilePath: require('path').resolve(__dirname, '../.env') }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    AuditLogsModule,
    NotificationsModule,
    MailModule,
    CustomerModule,
    SubscriptionsModule,
    CrmModule,
  ],
})
export class AppModule {}