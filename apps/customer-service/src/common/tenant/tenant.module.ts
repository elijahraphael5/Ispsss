import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantService } from './tenant.service';
import { TenantInterceptor } from './tenant.interceptor';

@Global()
@Module({
  providers: [
    TenantService,
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
  exports: [TenantService],
})
export class TenantModule {}
