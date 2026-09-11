import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantSettingsService } from './tenant-settings.service';
import { UpdateTenantSettingsDto } from './dto/tenant-settings.dto';

const SETTINGS_ROLES = ['SUPER_ADMIN', 'OPERATIONS_MANAGER'] as const;

@ApiTags('tenant-settings')
@Controller('tenant/settings')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TenantSettingsController {
  constructor(private readonly service: TenantSettingsService) {}

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
}
