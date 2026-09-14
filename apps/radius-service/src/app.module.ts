import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma/prisma.module';
import { JwtAuthModule } from './common/auth/jwt-auth.module';
import { RadiusModule } from './modules/radius/radius.module';

@Module({
  imports: [
    PrismaModule,
    JwtAuthModule,
    ConfigModule.forRoot({ isGlobal: true, envFilePath: require('path').resolve(__dirname, '../.env') }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    RadiusModule,
  ],
})
export class AppModule {}