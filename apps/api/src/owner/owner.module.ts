import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OwnerController } from './owner.controller';
import { OwnerService } from './owner.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET ?? 'change-me',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [OwnerController],
  providers: [OwnerService],
})
export class OwnerModule {}
