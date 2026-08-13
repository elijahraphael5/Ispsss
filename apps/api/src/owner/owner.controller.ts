import { Controller, Get, Post, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { OwnerService } from './owner.service';

@ApiTags('owner')
@Controller('owner')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SUPERADMIN')
export class OwnerController {
  constructor(
    private readonly service: OwnerService,
    private readonly jwt: JwtService,
  ) {}

  @Get('tenants')
  listTenants() {
    return this.service.listTenants();
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.service.getTenantById(id);
  }

  @Get('tenants/:id/users')
  getTenantUsers(@Param('id') id: string) {
    return this.service.getTenantUsers(id);
  }

  @Get('tenants/:id/subscribers')
  getTenantSubscribers(@Param('id') id: string) {
    return this.service.getTenantSubscribers(id);
  }

  @Post('impersonate/:tenantId')
  impersonate(@Req() req: { user: { id: string; isSuperAdmin: boolean } }, @Param('tenantId') tenantId: string) {
    if (!req.user.isSuperAdmin) {
      return { error: 'Forbidden' };
    }
    const token = this.jwt.sign(
      { sub: req.user.id, impersonatedTenantId: tenantId },
      { secret: process.env.JWT_ACCESS_SECRET ?? 'change-me', expiresIn: '15m' },
    );
    return { accessToken: token, tenantId };
  }

  @Post('unimpersonate')
  unimpersonate(@Req() req: { user: { id: string } }) {
    const token = this.jwt.sign(
      { sub: req.user.id },
      { secret: process.env.JWT_ACCESS_SECRET ?? 'change-me', expiresIn: '15m' },
    );
    return { accessToken: token };
  }
}
