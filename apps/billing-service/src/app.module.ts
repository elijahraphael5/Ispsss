import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './common/prisma/prisma.module';
import { JwtAuthModule } from './common/auth/jwt-auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { MailModule } from './modules/mail/mail.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { JobsModule } from './jobs/jobs.module';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

@Module({
  imports: [
    PrismaModule,
    JwtAuthModule,
    ConfigModule.forRoot({ isGlobal: true, envFilePath: require('path').resolve(__dirname, '../.env') }),
    AuditLogsModule,
    NotificationsModule,
    MailModule,
    BillingModule,
    ...(redisUrl === 'none' ? [] : [BullModule.forRoot({ connection: { url: redisUrl } }), JobsModule]),
  ],
})
export class AppModule {}