import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RouterOsService } from './routeros.service';
import { RouterSnapshotService } from './router-snapshot.service';
import { ActionQueueService } from './action-queue.service';

@ApiTags('routeros')
@Controller('routeros')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class RouterOsController {
  constructor(
    private readonly service: RouterOsService,
    private readonly snapshot: RouterSnapshotService,
    private readonly actionQueue: ActionQueueService,
  ) {}

  // ─── Queues ────────────────────────────────────────────────

  @Get('devices/:deviceId/queues')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN')
  getQueues(@Param('deviceId') deviceId: string) {
    return this.service.getQueues(deviceId);
  }

  @Get('bandwidth')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN')
  getBandwidth() {
    return this.service.getAllDevicesBandwidth();
  }

  @Get('devices/:deviceId/bandwidth')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN')
  getDeviceBandwidth(@Param('deviceId') deviceId: string) {
    return this.service.getBandwidthStats(deviceId);
  }

  @Post('devices/:deviceId/queues')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN')
  createQueue(@Param('deviceId') deviceId: string, @Body() body: Record<string, any>) {
    return this.service.createQueue(deviceId, body);
  }

  @Patch('devices/:deviceId/queues/:queueId')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN')
  updateQueue(@Param('deviceId') deviceId: string, @Param('queueId') queueId: string, @Body() body: Record<string, any>) {
    return this.service.updateQueue(deviceId, queueId, body);
  }

  @Delete('devices/:deviceId/queues/:queueId')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN')
  deleteQueue(@Param('deviceId') deviceId: string, @Param('queueId') queueId: string) {
    return this.service.deleteQueue(deviceId, queueId);
  }

  // ─── Sessions ─────────────────────────────────────────────

  @Get('devices/:deviceId/sessions')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN')
  getSessions(@Param('deviceId') deviceId: string) {
    return this.service.getActiveSessions(deviceId);
  }

  @Post('devices/:deviceId/sessions/:sessionId/disconnect')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER')
  disconnectSession(@Param('deviceId') deviceId: string, @Param('sessionId') sessionId: string) {
    return this.service.disconnectSession(deviceId, sessionId);
  }

  @Get('devices/:deviceId/dhcp-leases')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER')
  getDhcpLeases(@Param('deviceId') deviceId: string) {
    return this.service.getDhcpLeases(deviceId);
  }

  @Get('devices/:deviceId/address-lists')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER')
  getAddressLists(@Param('deviceId') deviceId: string) {
    return this.service.getAddressLists(deviceId);
  }

  @Post('devices/:deviceId/address-lists')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER')
  addAddressListEntry(@Param('deviceId') deviceId: string, @Body() body: { address: string; list: string; comment?: string }) {
    return this.service.addAddressListEntry(deviceId, body);
  }

  @Delete('devices/:deviceId/address-lists/:listId')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER')
  removeAddressListEntry(@Param('deviceId') deviceId: string, @Param('listId') listId: string) {
    return this.service.removeAddressListEntry(deviceId, listId);
  }

  @Get('devices/:deviceId/wireless-clients')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER')
  getWirelessClients(@Param('deviceId') deviceId: string) {
    return this.service.getWirelessClients(deviceId);
  }

  @Get('devices/:deviceId/ppp-profiles')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER')
  getPppProfiles(@Param('deviceId') deviceId: string) {
    return this.service.getPppProfiles(deviceId);
  }

  @Get('devices/:deviceId/system-health')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN')
  getSystemHealth(@Param('deviceId') deviceId: string) {
    return this.service.getSystemHealth(deviceId);
  }

  @Get('devices/:deviceId/logs')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER')
  getLogs(@Param('deviceId') deviceId: string, @Query('limit') limit?: string) {
    return this.service.getLogs(deviceId, parseInt(limit || '100', 10));
  }

  @Get('devices/:deviceId/ip-addresses')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN')
  getIpAddresses(@Param('deviceId') deviceId: string) {
    return this.service.getIpAddresses(deviceId);
  }

  @Get('devices/:deviceId/routes')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN')
  getRoutes(@Param('deviceId') deviceId: string) {
    return this.service.getRoutes(deviceId);
  }

  @Get('devices/:deviceId/pools')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN')
  getPools(@Param('deviceId') deviceId: string) {
    return this.service.getPools(deviceId);
  }

  @Post('devices/:deviceId/ping')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER')
  ping(@Param('deviceId') deviceId: string, @Body() body: { address: string; count?: number }) {
    return this.service.pingAddress(deviceId, body.address, body.count || 3);
  }

  @Post('devices/:deviceId/sync-sessions')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN')
  syncSessions(@Param('deviceId') deviceId: string) {
    return this.service.syncSessions(deviceId);
  }

  // ─── PPP Secrets (Subscribers) ───────────────────────────

  @Get('devices/:deviceId/subscribers')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'SALES_AGENT', 'CUSTOMER_SUPPORT', 'SUPPORT_AGENT')
  getPppSecrets(@Param('deviceId') deviceId: string) {
    return this.service.getPppSecrets(deviceId);
  }

  @Post('devices/:deviceId/subscribers')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN', 'SALES_AGENT')
  createPppSecret(@Param('deviceId') deviceId: string, @Body() body: { name: string; password: string; profile: string; comment?: string }) {
    return this.service.createPppSecret(deviceId, body);
  }

  @Patch('devices/:deviceId/subscribers/:secretId')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN', 'SALES_AGENT')
  updatePppSecret(@Param('deviceId') deviceId: string, @Param('secretId') secretId: string, @Body() body: any) {
    if (body.disabled === 'yes') return this.actionQueue.suspend(deviceId, secretId);
    if (body.profile) return this.actionQueue.planChange(deviceId, secretId, body.profile);
    return this.service.updatePppSecret(deviceId, secretId, body);
  }

  @Delete('devices/:deviceId/subscribers/:secretId')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN', 'OPERATIONS_MANAGER')
  deletePppSecret(@Param('deviceId') deviceId: string, @Param('secretId') secretId: string) {
    return this.service.deletePppSecret(deviceId, secretId);
  }

  // ─── Static IP / ARP Sync ───────────────────────────────

  @Post('sync-arp')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN')
  syncArp(@Body('deviceId') deviceId?: string) {
    return this.service.syncArpToSubscribers(deviceId);
  }

  @Get('arp-entries')
  @Roles('NOC_ENGINEER', 'SUPER_ADMIN')
  getArpEntries(@Query('deviceId') deviceId?: string) {
    return this.service.getArpEntries(deviceId);
  }

  // ─── System ───────────────────────────────────────────────

  @Get('devices/:deviceId/system')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN')
  getSystem(@Param('deviceId') deviceId: string) {
    return this.service.getSystemResource(deviceId);
  }

  @Get('devices/:deviceId/interfaces')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN')
  getInterfaces(@Param('deviceId') deviceId: string) {
    return this.service.getInterfaces(deviceId);
  }

  // ─── Snapshots (DB copy of RouterOS data, survives outages) ──

  @Post('snapshots/sync')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER')
  syncSnapshots() {
    return this.snapshot.snapshotAll();
  }

  @Get('snapshots')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER', 'SALES_AGENT', 'CUSTOMER_SUPPORT', 'SUPPORT_AGENT', 'BILLING_OFFICER', 'FINANCE_MANAGER')
  getSnapshots() {
    return this.snapshot.listSnapshots();
  }

  @Patch('snapshots/:username')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER')
  updateSnapshotProfile(@Param('username') username: string, @Body() body: { name?: string; email?: string; phone?: string; address?: string; installerName?: string }) {
    return this.snapshot.updateProfile(username, body);
  }

  @Get('metrics')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER')
  getMetrics(@Query('username') username?: string, @Query('ip') ip?: string, @Query('limit') limit?: string) {
    return this.snapshot.listMetrics(username, ip, parseInt(limit || '60', 10));
  }

  @Get('usage')
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER')
  getUsage(@Query('username') username: string, @Query('range') range = 'daily') {
    return this.snapshot.listUsage(username, range);
  }
}
