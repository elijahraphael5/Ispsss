import { Controller, Get, Post, Param, Body, UseGuards, Req, Query, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CustomerService } from './customer.service';
import { SupportClientService } from './support-client.service';

@ApiTags('customer')
@Controller('customer')
@UseGuards(AuthGuard('jwt'))
export class CustomerController {
  constructor(
    private readonly service: CustomerService,
    private readonly support: SupportClientService,
  ) {}

  @Get('dashboard')
  dashboard(@Req() req: any) {
    return this.service.getDashboard(req.user.id);
  }

  @Get('access')
  access(@Req() req: any) {
    return this.service.getAccess(req.user.id);
  }

  @Get('analytics')
  analytics(@Req() req: any) {
    return this.service.getAnalytics(req.user.id);
  }

  @Post('subscription/action')
  subscriptionAction(@Req() req: any, @Body() body: { action: string; planId?: string; reference: string }) {
    return this.service.handleSubscriptionAction(req.user.id, body);
  }

  @Get('invoices')
  invoices(@Req() req: any, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.service.getInvoices(req.user.id, { skip: skip ? parseInt(skip, 10) : undefined, take: take ? parseInt(take, 10) : undefined });
  }

  @Get('payments')
  payments(@Req() req: any, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.service.getPayments(req.user.id, { skip: skip ? parseInt(skip, 10) : undefined, take: take ? parseInt(take, 10) : undefined });
  }

  @Get('receipts')
  receipts(@Req() req: any, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.service.getReceipts(req.user.id, { skip: skip ? parseInt(skip, 10) : undefined, take: take ? parseInt(take, 10) : undefined });
  }

  // Customer ticket endpoints
  @Get('tickets')
  listTickets(@Req() req: any, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.service.getTickets(req.user.id, { skip: skip ? parseInt(skip, 10) : undefined, take: take ? parseInt(take, 10) : undefined });
  }

  @Get('tickets/:id')
  getTicket(@Req() req: any, @Param('id') id: string) {
    return this.service.getTicket(req.user.id, id);
  }

  @Post('tickets')
  createTicket(@Req() req: any, @Body() body: { subject: string; description?: string; category?: string; priority?: string }) {
    return this.support.createCustomerTicket(req.user.id, req.headers?.authorization, body);
  }

  @Post('tickets/:id/reply')
  replyTicket(@Req() req: any, @Param('id') id: string, @Body() body: { message: string }) {
    return this.service.replyTicket(req.user.id, id, body);
  }

  @Patch('profile')
  updateProfile(@Req() req: any, @Body() body: { firstName?: string; lastName?: string; companyName?: string; phone?: string; secondaryPhone?: string; email?: string; address?: string; stationLabel?: string; ipAddress?: string }) {
    return this.service.updateOwnProfile(req.user.id, body);
  }
}
