import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantService } from '../../common/tenant/tenant.service';
import { MailService } from '../mail/mail.service';

describe('AuthService', () => {
  let service: AuthService;
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    passwordResetToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((ops: any) => Promise.all(ops)),
  };
  const tenant = { resolveTenant: jest.fn().mockResolvedValue('tenant-1') };
  const mail = { sendLoginAlert: jest.fn().mockResolvedValue(undefined), send: jest.fn().mockResolvedValue(undefined) };
  const jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
  const hashOf = (s: string) => require('crypto').createHash('sha256').update(s).digest('hex');

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantService, useValue: tenant },
        { provide: MailService, useValue: mail },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('register', () => {
    it('hashes the password and creates the user with resolved tenant', async () => {
      prisma.user.create.mockResolvedValue({ id: 'u1', email: 'a@b.co', createdAt: new Date() });
      const result = await service.register('a@b.co', 'secret123', '0801');
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant-1', email: 'a@b.co', passwordHash: expect.any(String), phone: '0801' },
        select: { id: true, email: true, createdAt: true },
      });
      const hash = prisma.user.create.mock.calls[0][0].data.passwordHash;
      expect(hash).not.toBe('secret123');
      expect(await bcrypt.compare('secret123', hash)).toBe(true);
      expect(result).toEqual({ id: 'u1', email: 'a@b.co', createdAt: expect.any(Date) });
    });
  });

  describe('login', () => {
    const user = { id: 'u1', email: 'a@b.co', passwordHash: '', twoFaEnabled: false };

    beforeEach(() => {
      user.passwordHash = bcrypt.hashSync('pass123', 4);
    });

    it('rejects unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login('x@y.z', 'pass123')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      await expect(service.login('a@b.co', 'wrong')).rejects.toThrow(UnauthorizedException);
    });

    it('requests 2FA when enabled and does not issue tokens', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...user, twoFaEnabled: true });
      const result = await service.login('a@b.co', 'pass123');
      expect(result).toEqual({ twoFaRequired: true, userId: 'u1' });
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('issues tokens and dispatches login alert on success', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });
      const result = (await service.login('a@b.co', 'pass123', '1.2.3.4', 'UA')) as { accessToken: string; refreshToken: string };
      expect(result.accessToken).toBe('Bearer signed.jwt.token');
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(mail.sendLoginAlert).toHaveBeenCalledWith('a@b.co', '1.2.3.4', 'UA');
      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'u1', expiresAt: expect.any(Date) }),
      });
    });
  });

  describe('2FA', () => {
    it('rejects verify when no secret configured', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', twoFaSecret: null });
      await expect(service.verify2fa('u1', '123456')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an invalid TOTP token', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', twoFaSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' });
      await expect(service.verify2fa('u1', '000000')).rejects.toThrow(UnauthorizedException);
    });

    it('accepts a valid TOTP token and issues tokens', async () => {
      const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const speakeasy = require('speakeasy');
      const token = speakeasy.totp({ secret, encoding: 'base32' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', email: 'a@b.co', twoFaSecret: secret });
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });
      const result = await service.verify2fa('u1', token);
      expect(result.accessToken).toBe('Bearer signed.jwt.token');
    });

    it('setup returns otpauth URL and persists the secret', async () => {
      prisma.user.update.mockResolvedValue({});
      const res = await service.setup2fa('u1');
      expect(res.secret).toEqual(expect.any(String));
      expect(res.otpauthUrl).toContain('otpauth://');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' }, data: { twoFaSecret: res.secret } }),
      );
    });
  });

  describe('refreshTokens', () => {
    const raw = 'raw-token';

    it('throws for unknown token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refreshTokens(raw)).rejects.toThrow(UnauthorizedException);
    });

    it('rotates a live token and revokes the old one', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ id: 'rt1', family: 'f1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() + 100000) });
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt2' });
      const result = await service.refreshTokens(raw);
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(result.refreshToken).not.toBe(raw);
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'rt1' }, data: { revokedAt: expect.any(Date) } }));
    });

    it('revokes the whole family on reuse', async () => {
      const revoked = new Date(Date.now() - 1000);
      prisma.refreshToken.findUnique.mockResolvedValue({ id: 'rt1', family: 'f1', userId: 'u1', revokedAt: revoked, expiresAt: new Date(Date.now() + 100000) });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.refreshTokens(raw)).rejects.toThrow(UnauthorizedException);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { family: 'f1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rejects expired token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ id: 'rt1', family: 'f1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() - 1000) });
      await expect(service.refreshTokens(raw)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('password reset', () => {
    it('forgotPassword answers generically to avoid enumeration', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const res = await service.forgotPassword('ghost@x.co');
      expect(res.message).toContain('If that email exists');
    });

    it('forgotPassword stores a hashed token and emails a reset link', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.co' });
      prisma.passwordResetToken.create.mockResolvedValue({ id: 'prt1' });
      await service.forgotPassword('a@b.co');
      expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'u1', expiresAt: expect.any(Date) }),
      });
      expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@b.co', subject: 'Reset your password' }));
    });

    it('resetPassword rejects unknown token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);
      await expect(service.resetPassword('tok', 'newpass')).rejects.toThrow(UnauthorizedException);
    });

    it('resetPassword rejects expired token (legacy unused fields tolerated)', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({ id: 'prt1', usedAt: null, expiresAt: new Date(Date.now() - 1000) });
      await expect(service.resetPassword('tok', 'newpass')).rejects.toThrow(UnauthorizedException);
    });

    it('resetPassword updates the password hash and marks token used', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt1', userId: 'u1', tokenHash: hashOf('tok'), usedAt: null, expiresAt: new Date(Date.now() + 100000),
      });
      prisma.user.update.mockResolvedValue({});
      prisma.passwordResetToken.update.mockResolvedValue({});
      const res = await service.resetPassword('tok', 'newpass123');
      expect(res.message).toBe('Password updated successfully.');
      expect(prisma.$transaction).toHaveBeenCalled();
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(await bcrypt.compare('newpass123', data.passwordHash)).toBe(true);
    });
  });
});