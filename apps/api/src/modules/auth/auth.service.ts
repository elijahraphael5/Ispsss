import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as speakeasy from 'speakeasy';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantService } from '../../common/tenant/tenant.service';
import { MailService } from '../mail/mail.service';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly tenant: TenantService,
    private readonly mail: MailService,
  ) {}

  async register(email: string, password: string, phone?: string) {
    const passwordHash = await bcrypt.hash(password, 12);
    const tenantId = await this.tenant.resolveTenant();
    return this.prisma.user.create({
      data: { tenantId, email, passwordHash, phone },
      select: { id: true, email: true, createdAt: true },
    });
  }

  async login(email: string, password: string, ip?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (user.twoFaEnabled) {
      return { twoFaRequired: true, userId: user.id };
    }

    this.mail.sendLoginAlert(email, ip, userAgent).catch(() => {});
    return this.issueTokens(user.id);
  }

  async verify2fa(userId: string, token: string, ip?: string, userAgent?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFaSecret) throw new UnauthorizedException('2FA not configured');

    const verified = speakeasy.totp.verify({
      secret: user.twoFaSecret,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!verified) throw new UnauthorizedException('Invalid 2FA token');

    this.mail.sendLoginAlert(user.email, ip, userAgent).catch(() => {});
    return this.issueTokens(user.id);
  }

  async setup2fa(userId: string) {
    const secret = speakeasy.generateSecret({ name: `Hikonnect:${userId}` });
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFaSecret: secret.base32 },
    });
    return { secret: secret.base32, otpauthUrl: secret.otpauth_url };
  }

  async verify2faSetup(userId: string, token: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFaSecret) throw new Error('2FA not initialized');

    const verified = speakeasy.totp.verify({
      secret: user.twoFaSecret,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!verified) throw new Error('Invalid 2FA token');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFaEnabled: true },
    });
  }

  async getProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, phone: true, isSuperAdmin: true, twoFaEnabled: true, createdAt: true,
        customRoleId: true,
        customRole: {
          select: {
            id: true, name: true,
            permissions: { select: { module: true, canView: true, canCreate: true, canEdit: true, canDelete: true } },
          },
        },
      },
    });
  }

  async issueTokens(userId: string, family?: string) {
    const accessToken = this.jwtService.sign(
      { sub: userId },
      { secret: process.env.JWT_ACCESS_SECRET ?? 'change-me', expiresIn: '15m' },
    );

    const tokenFamily = family ?? crypto.randomUUID();
    const raw = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        family: tokenFamily,
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken: `Bearer ${accessToken}`, refreshToken: raw };
  }

  async refreshTokens(rawToken: string) {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    if (stored.revokedAt) {
      const reusedWithinGrace = Date.now() - new Date(stored.revokedAt).getTime() < 60_000;
      if (reusedWithinGrace) {
        const live = await this.prisma.refreshToken.findFirst({
          where: { family: stored.family, revokedAt: null },
        });
        if (live) {
          await this.prisma.refreshToken.update({
            where: { id: live.id },
            data: { revokedAt: new Date() },
          });
          return this.issueTokens(stored.userId, stored.family);
        }
      }
      await this.prisma.refreshToken.updateMany({
        where: { family: stored.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected — family revoked');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(stored.userId, stored.family);
  }

  async logout(tokenHash: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { message: 'If that email exists, a reset link has been sent.' };
    }

    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';
    const resetLink = `${frontendUrl}/login/reset?token=${raw}`;

    try {
      await this.mail.send({
        to: email,
        subject: 'Reset your password',
        html: `
          <h2>Password Reset Request</h2>
          <p>Click the link below to reset your password. This link expires in 1 hour.</p>
          <p><a href="${resetLink}">${resetLink}</a></p>
          <p>If you did not request this, please ignore this email.</p>
        `,
      });
    } catch (err) {
      this.logger.error(`Failed to send reset email to ${email}: ${err}`);
    }

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const stored = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!stored) throw new UnauthorizedException('Invalid or expired reset token');
    if (stored.usedAt) throw new UnauthorizedException('Token already used');
    if (stored.expiresAt < new Date()) throw new UnauthorizedException('Token expired');

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash },
      }),
    ]);

    return { message: 'Password updated successfully.' };
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: { id: true, email: true, phone: true, isSuperAdmin: true, twoFaEnabled: true, createdAt: true },
    });
  }
}
