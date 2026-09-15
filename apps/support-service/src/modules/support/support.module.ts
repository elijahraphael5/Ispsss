import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { SupportCustomerController } from './support-customer.controller';
import { SupportGateway } from './support.gateway';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (config: ConfigService) => {
        const secret = config.get<string>('JWT_ACCESS_SECRET') || process.env.JWT_ACCESS_SECRET;
        if (!secret || secret === 'change-me') throw new Error('JWT_ACCESS_SECRET is required');
        return { secret, signOptions: { expiresIn: '15m' } as const };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [SupportController, SupportCustomerController],
  providers: [SupportService, SupportGateway],
  exports: [SupportService],
})
export class SupportModule {}