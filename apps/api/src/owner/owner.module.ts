import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OwnerController } from './owner.controller';
import { OwnerService } from './owner.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET ?? (() => { throw new Error('JWT_ACCESS_SECRET not configured') })(),
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [OwnerController],
  providers: [OwnerService],
})
export class OwnerModule {}
