import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TenantModule } from './common/tenant/tenant.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { JwtAuthModule } from './common/auth/jwt-auth.module';
import { SupportModule } from './modules/support/support.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    TenantModule,
    JwtAuthModule,
    ConfigModule.forRoot({ isGlobal: true, envFilePath: require('path').resolve(__dirname, '../.env') }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    AuditLogsModule,
    NotificationsModule,
    SupportModule,
  ],
})
export class AppModule {}