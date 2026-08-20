import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { SupportCustomerController } from './support-customer.controller';
import { SupportGateway } from './support.gateway';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET ?? 'change-me',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [SupportController, SupportCustomerController],
  providers: [SupportService, SupportGateway],
  exports: [SupportService],
})
export class SupportModule {}