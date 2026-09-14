import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';

@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: (() => { const v = process.env.JWT_ACCESS_SECRET; if (!v || v === 'change-me') throw new Error('JWT_ACCESS_SECRET is required'); return v; })(),
      signOptions: { expiresIn: '15m' },
    }),
  ],
  providers: [JwtStrategy],
  exports: [JwtModule],
})
export class JwtAuthModule {}