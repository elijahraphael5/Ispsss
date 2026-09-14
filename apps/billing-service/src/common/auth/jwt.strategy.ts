import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: (() => { const v = process.env.JWT_ACCESS_SECRET; if (!v || v === 'change-me') throw new Error('JWT_ACCESS_SECRET is required'); return v; })(),
    });
  }

  async validate(payload: { sub: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, isSuperAdmin: true, twoFaEnabled: true, customRoleId: true, customRole: { include: { permissions: true } } },
    });
    if (!user) return null;
    return user;
  }
}