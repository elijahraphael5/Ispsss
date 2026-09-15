import { Injectable, UnauthorizedException, Logger, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as speakeasy from 'speakeasy';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import * as crypto from 'crypto';
import { encryptSecret, decryptSecret } from '@isp/prisma';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private otpAttempts = new Map<string, { count: number; lockedUntil?: number }>();
  private otpResendAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mail: MailService) {}

  async register(email: string, password: string, phone?: string) {
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new BadRequestException('A valid email is required');
    }
    if (!password || String(password).length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const tenantId = (await this.prisma.tenant?.findFirst())?.id;
    return this.prisma.user.create({
      data: { tenantId, email: normalizedEmail, passwordHash, phone },
      select: { id: true, email: true, createdAt: true },
    });
  }

  // Dummy hash for timing leak mitigation when user not found (constant-time compare)
  private static readonly DUMMY_HASH = '$2a$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  async login(email: string, password: string, ip?: string, userAgent?: string) {
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    const user = await this.prisma.user.findFirst({ where: { email: normalizedEmail } });
    if (!user) {
      await bcrypt.compare(password, AuthService.DUMMY_HASH).catch(() => {});
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (user.twoFaEnabled) {
      const maskedEmail = await this.sendTwoFaOtp(user);
      // Issue short-lived temp token binding the 2FA step to this login attempt (5 min)
      const tempToken = this.jwtService.sign(
        { sub: user.id, purpose: '2fa-temp' },
        { secret: (() => { const v = process.env.JWT_ACCESS_SECRET; if (!v || v === 'change-me') throw new Error('JWT_ACCESS_SECRET is required'); return v; })(), expiresIn: '5m' },
      );
      return { twoFaRequired: true, userId: user.id, tempToken, method: 'email', email: maskedEmail };
    }

    this.mail.sendLoginAlert(email, ip, userAgent).catch(() => {});
    return this.issueTokens(user.id);
  }

  /** 6-digit email OTP, hashed at rest, valid for 5 minutes. */
  private async sendTwoFaOtp(user: { id: string; email: string }): Promise<string> {
    // 60s cooldown per user to prevent email bombing
    const last = this.otpResendAt.get(user.id);
    if (last && Date.now() - last < 60_000) {
      throw new BadRequestException('Please wait 60 seconds before requesting another code');
    }
    this.otpResendAt.set(user.id, Date.now());
    // Reset attempt counter on new OTP
    this.otpAttempts.delete(user.id);

    const code = String(crypto.randomInt(100000, 1000000));
    const otpHash = crypto.createHash('sha256').update(code).digest('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFaOtpHash: otpHash, twoFaOtpExpiresAt: new Date(Date.now() + 5 * 60 * 1000) },
    });
    this.mail.enqueue(() => this.mail.send({
      to: user.email,
      subject: 'Your Hikonnect login code',
      html: `
        <h2>Your login code</h2>
        <p>Use this code to finish signing in:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
        <p>This code expires in 5 minutes. If you did not try to sign in, change your password immediately.</p>
      `,
    }));
    return this.maskEmail(user.email);
  }

  private maskEmail(email: string): string {
    const [name, domain] = String(email ?? '').split('@');
    if (!domain) return email;
    const visible = name.slice(0, 2);
    return `${visible}${'*'.repeat(Math.max(1, name.length - visible.length))}@${domain}`;
  }

  private async resolveUserId(input: string): Promise<string> {
    if (!input) throw new UnauthorizedException('Missing user identifier');
    // If input looks like a JWT (contains dots), try to verify as temp token
    if (input.includes('.') && input.split('.').length === 3) {
      try {
        const payload = await this.jwtService.verifyAsync<{ sub: string; purpose?: string }>(input, {
          secret: (() => { const v = process.env.JWT_ACCESS_SECRET; if (!v || v === 'change-me') throw new Error('JWT_ACCESS_SECRET is required'); return v; })(),
        });
        if (payload.purpose === '2fa-temp' && payload.sub) return payload.sub;
      } catch {
        // not a valid temp token, treat as plain userId
      }
    }
    return input;
  }

  async resend2fa(userIdOrTemp: string) {
    const userId = await this.resolveUserId(userIdOrTemp);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFaEnabled) throw new UnauthorizedException('2FA is not enabled');
    const maskedEmail = await this.sendTwoFaOtp(user);
    // Issue new temp token for the resent attempt as well
    const tempToken = this.jwtService.sign(
      { sub: user.id, purpose: '2fa-temp' },
      { secret: (() => { const v = process.env.JWT_ACCESS_SECRET; if (!v || v === 'change-me') throw new Error('JWT_ACCESS_SECRET is required'); return v; })(), expiresIn: '5m' },
    );
    return { twoFaRequired: true, userId: user.id, tempToken, method: 'email', email: maskedEmail };
  }

  async verify2fa(userIdOrTemp: string, token: string, ip?: string, userAgent?: string) {
    const userId = await this.resolveUserId(userIdOrTemp);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const code = String(token ?? '').trim();

    // Check lockout
    const attempt = this.otpAttempts.get(userId);
    if (attempt?.lockedUntil && attempt.lockedUntil > Date.now()) {
      const secs = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
      throw new BadRequestException(`Too many failed attempts. Try again in ${secs}s`);
    }

    let verified = false;
    // Email OTP (primary) - use timingSafeEqual
    if (user.twoFaOtpHash && user.twoFaOtpExpiresAt && user.twoFaOtpExpiresAt > new Date()) {
      const hash = crypto.createHash('sha256').update(code).digest('hex');
      try {
        const a = Buffer.from(hash, 'hex');
        const b = Buffer.from(user.twoFaOtpHash, 'hex');
        if (a.length === b.length) {
          verified = crypto.timingSafeEqual(a, b);
        }
      } catch {
        verified = false;
      }
    }
    // TOTP fallback for accounts that still have an authenticator secret
    if (!verified && user.twoFaSecret) {
      const secret = decryptSecret(user.twoFaSecret) ?? user.twoFaSecret; // fallback for plaintext legacy
      verified = speakeasy.totp.verify({ secret, encoding: 'base32', token: code, window: 1 });
    }
    if (!verified) {
      const cur = this.otpAttempts.get(userId) ?? { count: 0 };
      cur.count += 1;
      if (cur.count >= 5) {
        cur.lockedUntil = Date.now() + 15 * 60 * 1000;
        // Invalidate OTP after lock
        await this.prisma.user.update({ where: { id: userId }, data: { twoFaOtpHash: null, twoFaOtpExpiresAt: null } }).catch(() => {});
        this.otpAttempts.set(userId, cur);
        throw new BadRequestException('Too many failed attempts. OTP invalidated. Request a new code.');
      }
      this.otpAttempts.set(userId, cur);
      throw new UnauthorizedException('Invalid or expired 2FA code');
    }

    // Success - clear attempts and OTP
    this.otpAttempts.delete(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFaOtpHash: null, twoFaOtpExpiresAt: null },
    });

    this.mail.sendLoginAlert(user.email, ip, userAgent).catch(() => {});
    return this.issueTokens(user.id);
  }

  async enable2fa(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFaEnabled: true },
    });
    return { twoFaEnabled: true, method: 'email' };
  }

  async disable2fa(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFaEnabled: false, twoFaOtpHash: null, twoFaOtpExpiresAt: null },
    });
    return { twoFaEnabled: false };
  }

  async setup2fa(userId: string) {
    const secret = speakeasy.generateSecret({ name: `Hikonnect:${userId}` });
    const encrypted = encryptSecret(secret.base32);
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFaSecret: encrypted },
    });
    return { secret: secret.base32, otpauthUrl: secret.otpauth_url };
  }

  async verify2faSetup(userId: string, token: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFaSecret) throw new BadRequestException('2FA not initialized');

    const secret = decryptSecret(user.twoFaSecret) ?? user.twoFaSecret;
    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!verified) throw new BadRequestException('Invalid 2FA token');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFaEnabled: true },
    });
  }

  async getProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, phone: true, isSuperAdmin: true, twoFaEnabled: true, createdAt: true,
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
      { secret: (() => { const v = process.env.JWT_ACCESS_SECRET; if (!v || v === 'change-me') throw new Error('JWT_ACCESS_SECRET is required'); return v; })(), expiresIn: '15m' });

    const tokenFamily = family ?? crypto.randomUUID();
    const raw = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        family: tokenFamily,
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        lastUsedAt: new Date(),
      },
    });

    return { accessToken, refreshToken: raw };
  }

  /** Sliding idle window: how long a session may stay untouched before it dies. */
  private idleTimeoutMs(): number {
    const raw = Number(process.env.SESSION_IDLE_TIMEOUT_MS ?? 60 * 60 * 1000);
    return Number.isFinite(raw) && raw > 0 ? raw : 60 * 60 * 1000;
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

    // Idle timeout: the session dies if no activity happened since the token
    // was last used — the whole family is revoked, forcing a fresh login.
    if (stored.lastUsedAt && Date.now() - new Date(stored.lastUsedAt).getTime() > this.idleTimeoutMs()) {
      await this.prisma.refreshToken.updateMany({
        where: { family: stored.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session expired due to inactivity');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(stored.userId, stored.family);
  }

  async logout(tokenHash: string) {
    // Revoke the ENTIRE token family (all devices/browser tabs of this session
    // family), not just the presented cookie.
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) return;
    await this.prisma.refreshToken.updateMany({
      where: { family: stored.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async forgotPassword(email: string) {
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    const user = await this.prisma.user.findFirst({ where: { email: normalizedEmail } });
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

    this.mail.enqueue(() => this.mail.send({
      to: email,
      subject: 'Reset your password',
      html: `
        <h2>Password Reset Request</h2>
        <p>Click the link below to reset your password. This link expires in 1 hour.</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <p>If you did not request this, please ignore this email.</p>
      `,
    }));

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    if (!newPassword || String(newPassword).length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }
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

    // Revoke all existing refresh families so stolen sessions can't persist
    await this.prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { message: 'Password updated successfully.' };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (!newPassword || String(newPassword).length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const ok = await bcrypt.compare(String(currentPassword ?? ''), user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    // Changing a password invalidates every session (all refresh-token families).
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { message: 'Password updated successfully. Please sign in again.' };
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: { id: true, email: true, phone: true, isSuperAdmin: true, twoFaEnabled: true, createdAt: true },
    });
  }
}
