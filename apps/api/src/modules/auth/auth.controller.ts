import { Controller, Get, Post, Body, Req, Res, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthService } from './auth.service';
import * as crypto from 'crypto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('register')
  async register(@Body() body: { email: string; password: string; phone?: string }) {
    return this.service.register(body.email, body.password, body.phone);
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const ip = req.ip || req.headers?.['x-forwarded-for'] || req.connection?.remoteAddress;
    const ua = req.headers?.['user-agent'];
    const result = await this.service.login(body.email, body.password, ip, ua);
    if ('twoFaRequired' in result) return result;
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Post('2fa/verify')
  async verify2fa(@Body() body: { userId: string; token: string }, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const ip = req.ip || req.headers?.['x-forwarded-for'] || req.connection?.remoteAddress;
    const ua = req.headers?.['user-agent'];
    const result = await this.service.verify2fa(body.userId, body.token, ip, ua);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Post('refresh')
  async refresh(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const raw = req.cookies?.refreshToken;
    if (!raw) throw new UnauthorizedException('No refresh token');
    const result = await this.service.refreshTokens(raw);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Post('logout')
  async logout(@Req() req: any) {
    const raw = req.cookies?.refreshToken;
    if (raw) {
      const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
      await this.service.logout(tokenHash);
    }
    return { message: 'Logged out' };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  me(@Req() req: any) {
    return this.service.getProfile(req.user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('2fa/setup')
  setup2fa(@Req() req: any) {
    return this.service.setup2fa(req.user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('2fa/verify-setup')
  verify2faSetup(@Req() req: any, @Body() body: { token: string }) {
    return this.service.verify2faSetup(req.user.id, body.token);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    return this.service.forgotPassword(body.email);
  }

  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; password: string }) {
    return this.service.resetPassword(body.token, body.password);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Get('users')
  listUsers() {
    return this.service.findAll();
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post('users')
  createUser(@Body() body: { email: string; password: string; phone?: string }) {
    return this.service.register(body.email, body.password, body.phone);
  }

  private setRefreshCookie(res: any, token: string) {
    res.cookie('refreshToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
}
