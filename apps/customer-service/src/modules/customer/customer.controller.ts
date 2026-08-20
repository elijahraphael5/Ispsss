import { Controller, Get, Post, Param, Body, UseGuards, Req } from '@nestjs/common';
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

  @Get('analytics')
  analytics(@Req() req: any) {
    return this.service.getAnalytics(req.user.id);
  }

  @Post('subscription/action')
  subscriptionAction(@Req() req: any, @Body() body: { action: string; planId?: string; reference: string }) {
    return this.service.handleSubscriptionAction(req.user.id, body);
  }

  @Get('invoices')
  invoices(@Req() req: any) {
    return this.service.getInvoices(req.user.id);
  }

  @Get('payments')
  payments(@Req() req: any) {
    return this.service.getPayments(req.user.id);
  }

  @Get('receipts')
  receipts(@Req() req: any) {
    return this.service.getReceipts(req.user.id);
  }

  // Customer ticket endpoints
  @Get('tickets')
  listTickets(@Req() req: any) {
    return this.service.getTickets(req.user.id);
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
}
