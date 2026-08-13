import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, BadRequestException } from '@nestjs/common';
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
  findAll() {
    return this.service.findAll();
  }

  @Get('customers')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CEO', 'NOC_ENGINEER', 'FIELD_ENGINEER', 'SALES_AGENT', 'CUSTOMER_SUPPORT', 'SUPPORT_AGENT', 'BILLING_OFFICER', 'FINANCE_MANAGER')
  customers() {
    return this.service.customers();
  }

  @Get('customers/:id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CEO', 'NOC_ENGINEER', 'FIELD_ENGINEER', 'SALES_AGENT', 'CUSTOMER_SUPPORT', 'SUPPORT_AGENT', 'BILLING_OFFICER', 'FINANCE_MANAGER')
  customerDetail(@Param('id') id: string) {
    return this.service.customerDetail(id);
  }

  @Patch('customers/:id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CEO', 'FIELD_ENGINEER')
  updateCustomer(@Param('id') id: string, @Body() body: { name?: string; email?: string; phone?: string; address?: string; installerName?: string; networkType?: string; planName?: string; dueAt?: string }, @CurrentUser('id') actorId: string) {
    return this.service.updateCustomer(id, body, actorId);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CEO')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  create(@Body() body: { email: string; password: string; phone?: string; customRoleId?: string }, @CurrentUser('id') actorId: string) {
    return this.service.create(body, actorId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  update(@Param('id') id: string, @Body() body: { email?: string; phone?: string; customRoleId?: string; password?: string; isSuperAdmin?: boolean }, @CurrentUser('id') actorId: string) {
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
    await this.mail.sendPasswordReset(user.email, newPassword);
    return { message: 'Password updated — give this password to the customer', email: user.email, newPassword };
  }
}
