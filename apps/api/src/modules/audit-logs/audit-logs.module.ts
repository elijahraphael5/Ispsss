import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogsController } from './audit-logs.controller';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit-interceptor';

@Global()
@Module({
  controllers: [AuditLogsController],
  providers: [
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditLogsModule {}
