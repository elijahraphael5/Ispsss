import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { JwtAuthModule } from './common/auth/jwt-auth.module';
import { RadiusModule } from './modules/radius/radius.module';

@Module({
  imports: [
    PrismaModule,
    JwtAuthModule,
    ConfigModule.forRoot({ isGlobal: true, envFilePath: require('path').resolve(__dirname, '../.env') }),
    RadiusModule,
  ],
})
export class AppModule {}