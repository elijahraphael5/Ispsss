import { Controller, Get, Patch, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantSettingsService } from './tenant-settings.service';
import { UpdateTenantSettingsDto } from './dto/tenant-settings.dto';
import { MailService } from '../mail/mail.service';

const SETTINGS_ROLES = ['SUPER_ADMIN', 'OPERATIONS_MANAGER'] as const;

@ApiTags('tenant-settings')
@Controller('tenant/settings')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TenantSettingsController {
  constructor(private readonly service: TenantSettingsService, private readonly mail: MailService) {}

  @Get()
  @Roles(...SETTINGS_ROLES)
  get() {
    return this.service.get();
  }

  @Get('public-config')
  publicConfig() {
    return this.service.publicConfig();
  }

  @Patch()
  @Roles(...SETTINGS_ROLES)
  update(@Body() dto: UpdateTenantSettingsDto) {
    return this.service.update(dto);
  }

  @Post('test-email')
  @Roles(...SETTINGS_ROLES)
  async testEmail(@Body() body: { to: string }) {
    if (!body?.to || !/.+@.+\..+/.test(body.to)) return { ok: false, message: 'Valid "to" email is required' };
    return this.mail.sendTest(body.to);
  }

  @Get('smtp/verify')
  @Roles(...SETTINGS_ROLES)
  async verifySmtp() {
    return this.mail.verifyConnection();
  }
}
