import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { NetworkService } from './network.service';

const NETWORK_READ_ROLES = ['NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER', 'SUPPORT_AGENT', 'CUSTOMER_SUPPORT', 'SALES_AGENT', 'BILLING_OFFICER', 'FINANCE_MANAGER'];

@ApiTags('network')
@Controller('network')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class NetworkController {
  constructor(private readonly service: NetworkService) {}

  // ── Dashboard ──────────────────────────────────────────────

  @Get('dashboard')
  @Roles(...NETWORK_READ_ROLES)
  dashboard() {
    return this.service.getDashboard();
  }

  // ── Devices ────────────────────────────────────────────────

  @Get('devices')
  @Roles(...NETWORK_READ_ROLES)
  findAllDevices() {
    return this.service.findAllDevices();
  }

  @Get('devices/:id')
  @Roles(...NETWORK_READ_ROLES)
  findDevice(@Param('id') id: string) {
    return this.service.findDevice(id);
  }

  @Post('devices')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN')
  createDevice(@Body() body: { name: string; type: string; ipAddress: string; vendor?: string; location?: string; secret?: string }) {
    return this.service.createDevice(body);
  }

  @Patch('devices/:id')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN')
  updateDevice(@Param('id') id: string, @Body() body: any) {
    return this.service.updateDevice(id, body);
  }

  // ── PPPoE Sessions ─────────────────────────────────────────

  @Get('sessions')
  @Roles(...NETWORK_READ_ROLES)
  listSessions(@Query('active') active?: string, @Query('username') username?: string) {
    return this.service.listSessions({ active: active === 'true' ? true : active === 'false' ? false : undefined, username });
  }

  @Post('sessions/:id/disconnect')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN')
  disconnectSession(@Param('id') id: string) {
    return this.service.disconnectSession(id);
  }

  // ── Unified Connections ──────────────────────────────────

  @Get('connections')
  @Roles(...NETWORK_READ_ROLES)
  getAllConnections() {
    return this.service.getAllConnections();
  }

  @Get('bandwidth')
  @Roles(...NETWORK_READ_ROLES)
  getBandwidth(@Query('range') range?: string) {
    return this.service.getBandwidth((range as 'hourly' | 'daily' | 'monthly') ?? 'hourly');
  }

  // ── Legacy device list (for backwards compat) ──────────────

  @Get()
  @Roles(...NETWORK_READ_ROLES)
  findAll() {
    return this.service.findAllDevices();
  }

  @Get(':id')
  @Roles(...NETWORK_READ_ROLES)
  findOne(@Param('id') id: string) {
    return this.service.findDevice(id);
  }

  // ── CPE / IP Management ──────────────────────────────────

  @Get('subscribers/:id/cpes')
  @Roles(...NETWORK_READ_ROLES)
  listCpes(@Param('id') id: string) {
    return this.service.listCpes(id);
  }

  @Post('subscribers/:id/cpes')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN')
  createCpe(@Param('id') id: string, @Body() body: { name?: string; ipAddress: string; macAddress?: string }) {
    return this.service.createCpe(id, body);
  }

  @Patch('cpes/:id')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN')
  updateCpe(@Param('id') id: string, @Body() body: { name?: string; ipAddress?: string }) {
    return this.service.updateCpe(id, body);
  }

  @Delete('cpes/:id')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN')
  deleteCpe(@Param('id') id: string) {
    return this.service.deleteCpe(id);
  }
}
