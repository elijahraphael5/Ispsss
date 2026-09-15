import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { JwtAuthModule } from './common/auth/jwt-auth.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { BillingModule } from './modules/billing/billing.module';
import { MailModule } from './modules/mail/mail.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    JwtAuthModule,
    ConfigModule.forRoot({ isGlobal: true, envFilePath: require('path').resolve(__dirname, '../.env') }),
    AuditLogsModule,
    NotificationsModule,
    MailModule,
    BillingModule,
    PaymentsModule,
  ],
})
export class AppModule {}