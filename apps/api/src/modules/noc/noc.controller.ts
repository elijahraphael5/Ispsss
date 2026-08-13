import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { NocService } from './noc.service';

@ApiTags('noc')
@Controller('noc')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class NocController {
  constructor(private readonly service: NocService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'NOC_ENGINEER', 'CEO')
  getDashboard() {
    return this.service.getDashboard();
  }

  @Get('devices/:id')
  @Roles('SUPER_ADMIN', 'NOC_ENGINEER', 'CEO')
  getDevice(@Param('id') id: string) {
    return this.service.getDeviceLog(id);
  }

  @Patch('devices/:id/status')
  @Roles('SUPER_ADMIN', 'NOC_ENGINEER')
  updateDeviceStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.service.updateDeviceStatus(id, body.status);
  }

  @Patch('cpes/:id/status')
  @Roles('SUPER_ADMIN', 'NOC_ENGINEER')
  updateCpeStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.service.updateCpeStatus(id, body.status);
  }

  @Post('cpes')
  @Roles('SUPER_ADMIN', 'NOC_ENGINEER', 'FIELD_ENGINEER')
  registerCpe(@Body() body: { subscriberId: string; macAddress: string; ipAddress?: string }) {
    return this.service.registerCpe(body);
  }
}
