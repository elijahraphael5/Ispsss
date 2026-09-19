import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, UseInterceptors, UploadedFile, BadRequestException, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { MailService } from '../mail/mail.service';
import * as crypto from 'crypto';

@ApiTags('users')
@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
  constructor(
    private readonly service: UsersService,
    private readonly mail: MailService,
  ) {}

  @Get()
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CEO')
  findAll(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.service.findAll({ skip: skip ? parseInt(skip, 10) : undefined, take: take ? parseInt(take, 10) : undefined });
  }

  @Get('customers')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CEO', 'NOC_ENGINEER', 'FIELD_ENGINEER', 'SALES_AGENT', 'CUSTOMER_SUPPORT', 'SUPPORT_AGENT', 'BILLING_OFFICER', 'FINANCE_MANAGER')
  customers(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.service.customers({ skip: skip ? parseInt(skip, 10) : undefined, take: take ? parseInt(take, 10) : undefined });
  }

  @Get('customers/:id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CEO', 'NOC_ENGINEER', 'FIELD_ENGINEER', 'SALES_AGENT', 'CUSTOMER_SUPPORT', 'SUPPORT_AGENT', 'BILLING_OFFICER', 'FINANCE_MANAGER')
  customerDetail(@Param('id') id: string) {
    return this.service.customerDetail(id);
  }

  @Patch('customers/:id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CEO', 'FIELD_ENGINEER')
  updateCustomer(@Param('id') id: string, @Body() body: { name?: string; email?: string; phone?: string; secondaryPhone?: string; address?: string; installerName?: string; networkType?: string; pppoeUsername?: string; planName?: string; dueAt?: string; ipAddress?: string; staticIpAddress?: string; legacyId?: string; id2?: string; firstName?: string; lastName?: string; companyName?: string; stationLabel?: string; startedAt?: string; expiresAt?: string; installationFee?: string; installationFeeKobo?: number }, @CurrentUser('id') actorId: string) {
    return this.service.updateCustomer(id, body as any, actorId);
  }

  @Get('kyc')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CEO', 'NOC_ENGINEER', 'FIELD_ENGINEER', 'SALES_AGENT', 'CUSTOMER_SUPPORT', 'SUPPORT_AGENT', 'BILLING_OFFICER', 'FINANCE_MANAGER')
  kycQueue(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.service.kycQueue({ skip: skip ? parseInt(skip, 10) : undefined, take: take ? parseInt(take, 10) : undefined });
  }

  @Post('kyc/:id/approve')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CEO')
  approveKyc(@Param('id') id: string, @CurrentUser() actor: { id: string; isSuperAdmin?: boolean; customRole?: { name: string } | null }) {
    return this.service.approveKyc(id, actor);
  }

  @Post('kyc/:id/reject')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CEO')
  rejectKyc(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser('id') actorId: string) {
    return this.service.rejectKyc(id, actorId, body?.reason);
  }

  @Post('import')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  importCustomers(@UploadedFile() file: Express.Multer.File, @CurrentUser('id') actorId: string) {
    return this.service.startImport(file, actorId);
  }

  @Post('purge-customers')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  purgeCustomers(@CurrentUser('id') actorId: string) {
    return this.service.purgeCustomers(actorId);
  }

  @Get('import/:jobId')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  importStatus(@Param('jobId') jobId: string) {
    return this.service.importStatus(jobId);
  }

  @Post('launch')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  launch(@Body() body: { testEmail?: string }, @CurrentUser('id') actorId: string) {
    return this.service.launchLogins(body, actorId);
  }

  @Get('launch/:jobId')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  launchStatus(@Param('jobId') jobId: string) {
    return this.service.launchStatus(jobId);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CEO')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  create(@Body() body: { email: string; password: string; name?: string; phone?: string; secondaryPhone?: string; customRoleId?: string }, @CurrentUser('id') actorId: string) {
    return this.service.create(body, actorId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  update(
    @Param('id') id: string,
    @Body() body: { email?: string; name?: string; phone?: string; secondaryPhone?: string; customRoleId?: string; password?: string; isSuperAdmin?: boolean },
    @CurrentUser('id') actorId: string,
    @CurrentUser('isSuperAdmin') actorIsSuperAdmin: boolean,
  ) {
    // Only a superadmin may grant/revoke the platform superadmin flag —
    // otherwise an OPERATIONS_MANAGER could escalate themselves.
    if (!actorIsSuperAdmin) delete body.isSuperAdmin;
    return this.service.update(id, body, actorId);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  remove(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.service.remove(id, actorId);
  }

  @Post(':id/reset-password')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  async resetPassword(@Param('id') id: string, @Body() body: { password?: string }, @CurrentUser('id') actorId: string) {
    const user = await this.service.findOne(id);
    const desired = body?.password?.trim();
    if (desired && desired.length < 6) throw new BadRequestException('Password must be at least 6 characters');
    const newPassword = desired || crypto.randomBytes(4).toString('hex');
    await this.service.update(id, { password: newPassword }, actorId);
    this.mail.enqueue(() => this.mail.sendPasswordReset(user.email, newPassword));
    return { message: 'Password updated — give this password to the customer', email: user.email, newPassword };
  }
}
