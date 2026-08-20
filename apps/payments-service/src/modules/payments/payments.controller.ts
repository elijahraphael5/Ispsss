import { Controller, Get, Post, Patch, Param, Body, Req, UseGuards, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  // ── Dashboard ──────────────────────────────────────────────

  @Get('dashboard')
  @Roles('BILLING_OFFICER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN')
  dashboard() {
    return this.service.getDashboard();
  }

  // ── Payments ───────────────────────────────────────────────

  @Get()
  @Roles('BILLING_OFFICER', 'CEO', 'OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT', 'SUPER_ADMIN')
  findAll(@Query('status') status?: string, @Query('provider') provider?: string, @Query('search') search?: string, @Query('limit') limit?: string) {
    return this.service.findAll({ status, provider, search, limit: limit ? parseInt(limit, 10) : undefined });
  }

  // ── Refunds ────────────────────────────────────────────────

  @Get('refunds')
  @Roles('BILLING_OFFICER', 'CEO', 'FINANCE_MANAGER', 'SUPER_ADMIN')
  listRefunds(@Query('status') status?: string) {
    return this.service.listRefunds({ status });
  }

  @Get('reconciliation')
  @Roles('BILLING_OFFICER', 'CEO', 'FINANCE_MANAGER', 'SUPER_ADMIN')
  getReconciliation() {
    return this.service.getReconciliations();
  }

  @Get(':id')
  @Roles('BILLING_OFFICER', 'CEO', 'SUPER_ADMIN')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post('initialize')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  initialize(@Body() body: { invoiceId: string; email: string; amountKobo?: number; callbackUrl?: string }) {
    return this.service.initialize(body);
  }

  @Post('record-offline')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  recordOffline(@Body() body: { invoiceId: string; amountKobo: number; provider: string; reference: string }) {
    return this.service.recordOfflinePayment(body);
  }

  @Post('record-partial')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  recordPartial(@Body() body: { invoiceId: string; amountKobo: number; provider: string; reference: string }) {
    return this.service.recordPartialPayment(body);
  }

  @Post('direct')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  createDirect(@Body() body: { invoiceId: string; provider: string; amountKobo: number; reference: string; status?: string }) {
    return this.service.create(body);
  }

  // ── Wallet ─────────────────────────────────────────────────

  @Get('wallet/:subscriberId')
  @Roles('BILLING_OFFICER', 'CEO', 'CUSTOMER_SUPPORT', 'SUPER_ADMIN')
  getWallet(@Param('subscriberId') subscriberId: string) {
    return this.service.getWallet(subscriberId);
  }

  @Get('wallet/:subscriberId/transactions')
  @Roles('BILLING_OFFICER', 'CEO', 'CUSTOMER_SUPPORT', 'SUPER_ADMIN')
  walletTransactions(@Param('subscriberId') subscriberId: string) {
    return this.service.getWalletTransactions(subscriberId);
  }

  @Post('wallet/:subscriberId/credit')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  creditWallet(@Param('subscriberId') subscriberId: string, @Body() body: { amountKobo: number; reference: string; description?: string }) {
    return this.service.creditWallet(subscriberId, body.amountKobo, body.reference, body.description);
  }

  @Post('wallet/:subscriberId/debit')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  debitWallet(@Param('subscriberId') subscriberId: string, @Body() body: { amountKobo: number; reference: string; description?: string }) {
    return this.service.debitWallet(subscriberId, body.amountKobo, body.reference, body.description);
  }

  @Post('pay-with-wallet/:invoiceId')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  payWithWallet(@Param('invoiceId') invoiceId: string) {
    return this.service.payWithWallet(invoiceId);
  }

  // ── Virtual Accounts ───────────────────────────────────────

  @Get('virtual-accounts/:subscriberId')
  @Roles('BILLING_OFFICER', 'CEO', 'CUSTOMER_SUPPORT', 'SUPER_ADMIN')
  getVirtualAccounts(@Param('subscriberId') subscriberId: string) {
    return this.service.getVirtualAccounts(subscriberId);
  }

  @Post('virtual-accounts/:subscriberId')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  assignVirtualAccount(@Param('subscriberId') subscriberId: string) {
    return this.service.assignVirtualAccount(subscriberId);
  }

  // ── Refunds ────────────────────────────────────────────────

  @Post('refunds/request')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  requestRefund(@Body() body: { paymentId: string; amountKobo: number; reason?: string }) {
    return this.service.requestRefund(body);
  }

  @Patch('refunds/:id/approve')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  approveRefund(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.service.approveRefund(id, userId);
  }

  @Patch('refunds/:id/process')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  processRefund(@Param('id') id: string) {
    return this.service.processRefund(id);
  }

  @Patch('refunds/:id/reject')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  rejectRefund(@Param('id') id: string, @Body() body?: { reason?: string }) {
    return this.service.rejectRefund(id, body?.reason);
  }

  // ── Reconciliation ─────────────────────────────────────────

@Post('reconciliation')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  createReconciliation(@Body() body: {
    referenceDate: string;
    gatewayAmountKobo: number;
    bankAmountKobo?: number;
    invoiceAmountKobo?: number;
    notes?: string;
  }) {
    return this.service.createReconciliation({
      referenceDate: new Date(body.referenceDate),
      gatewayAmountKobo: body.gatewayAmountKobo,
      bankAmountKobo: body.bankAmountKobo,
      invoiceAmountKobo: body.invoiceAmountKobo,
      notes: body.notes,
    });
  }

  // ── Customer Self-Service Checkout ─────────────────────────

  @Post('customer/initialize')
  initializeCustomer(@Req() req: any, @Body() body: { action: 'renew' | 'change_plan' | 'add_plan'; planId?: string; email?: string }) {
    return this.service.initializeCustomerPayment(req.user.id, body);
  }

  @Get('customer/verify')
  verifyCustomer(@Req() req: any, @Query('reference') reference: string) {
    return this.service.finalizeCustomerPayment(reference);
  }

  // ── Webhook ────────────────────────────────────────────────

  @Post('webhook/generic')
  handleWebhook(@Body() body: { reference: string; status: string; provider: string; providerReference?: string }) {
    return this.service.handleGenericWebhook(body);
  }

}
