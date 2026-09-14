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
      secret: (() => { const v = process.env.JWT_ACCESS_SECRET; if (!v || v === 'change-me') throw new Error('JWT_ACCESS_SECRET is required'); return v; })(),
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [SupportController, SupportCustomerController],
  providers: [SupportService, SupportGateway],
  exports: [SupportService],
})
export class SupportModule {}