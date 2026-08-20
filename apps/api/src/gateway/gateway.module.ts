import { Module } from '@nestjs/common';
import { ServiceProxyMiddleware } from './service-proxy.middleware';

@Module({
  providers: [ServiceProxyMiddleware],
  exports: [ServiceProxyMiddleware],
})
export class GatewayModule {}