import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, NotFoundException, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { MailService, WelcomeData } from '../mail/mail.service';

@ApiTags('subscriptions')
@Controller('subscriptions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SubscriptionsController {
  constructor(
    private readonly service: SubscriptionsService,
    private readonly mail: MailService,
  ) {}

  @Get()
  @Roles('SUPER_ADMIN', 'SALES_AGENT', 'OPERATIONS_MANAGER', 'CEO', 'CUSTOMER_SUPPORT')
  findAll(@Query('skip') skip?: string, @Query('take') take?: string, @Query('search') search?: string, @Query('planFilter') planFilter?: string) {
    return this.service.findAll(Number(skip) || 0, Number(take) || 50, search, planFilter);
  }

  @Get('plans')
  listPlans() {
    return this.service.listPlans();
  }

  @Post('plans')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  createPlan(@Body() body: any) {
    return this.service.createPlan(body);
  }

  @Patch('plans/:id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  updatePlan(@Param('id') id: string, @Body() body: any) {
    return this.service.updatePlan(id, body);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'SALES_AGENT', 'OPERATIONS_MANAGER', 'CEO', 'CUSTOMER_SUPPORT')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'SALES_AGENT')
  create(@Body() body: { userId: string; type: string; address?: string; pppoeUsername?: string; networkType?: string }) {
    return this.service.create(body);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'SALES_AGENT', 'OPERATIONS_MANAGER')
  update(@Param('id') id: string, @Body() body: { type?: string; status?: string }) {
    return this.service.update(id, body);
  }

  @Post(':id/suspend')
  @Roles('SUPER_ADMIN', 'SALES_AGENT', 'OPERATIONS_MANAGER')
  async suspend(@Param('id') id: string) {
    return this.service.update(id, { status: 'SUSPENDED' });
  }

  @Post(':id/unsuspend')
  @Roles('SUPER_ADMIN', 'SALES_AGENT', 'OPERATIONS_MANAGER')
  async unsuspend(@Param('id') id: string) {
    return this.service.update(id, { status: 'ACTIVE' });
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/subscriptions')
  @Roles('SUPER_ADMIN', 'SALES_AGENT')
  createSubscription(@Param('id') id: string, @Body() body: { planId: string; autoRenew?: boolean; expiresAt: Date; installationFeeKobo?: number; routerProvided?: boolean; routerCostKobo?: number }) {
    return this.service.createSubscription({ subscriberId: id, ...body });
  }

  @Post(':id/send-welcome')
  @Roles('SUPER_ADMIN', 'SALES_AGENT', 'OPERATIONS_MANAGER')
  async sendWelcome(@Param('id') id: string, @Body() body: { password?: string }) {
    const full = await this.service.findOne(id);
    if (!full || !full.subscriptions?.length) throw new NotFoundException('No active subscription found');
    const sub = full.subscriptions[0];
    const plan = sub.plan;
    const user = full.user;
    if (!user) throw new NotFoundException('User not found');
    const welcomeData: WelcomeData = {
      email: user.email,
      password: body.password ?? 'Welcome123!',
      customerId: full.id.slice(0, 8).toUpperCase(),
      planName: plan.name,
      speedMbps: plan.speedMbps,
      monthlyCostKobo: plan.priceKobo,
      installationFeeKobo: plan.installationFeeKobo,

    };
    await this.mail.sendWelcome(welcomeData);
    return { message: 'Welcome email sent to ' + user.email };
  }

  @Patch('subscriptions/:id')
  @Roles('SUPER_ADMIN', 'SALES_AGENT', 'OPERATIONS_MANAGER')
  updateSubscription(@Param('id') id: string, @Body() body: { planId?: string; autoRenew?: boolean }) {
    return this.service.updateSubscription(id, body);
  }

  @Delete('subscriptions/:id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  removeSubscription(@Param('id') id: string) {
    return this.service.removeSubscription(id);
  }

  // ── CPE / IP Addresses ──────────────────────────────────
}
