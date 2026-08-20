import { Controller, Get, Post, Patch, Param, Body, UseGuards, Query, Headers, ForbiddenException, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BillingService } from './billing.service';

@ApiTags('billing')
@Controller('billing')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class BillingController {
  constructor(private readonly service: BillingService) {}

  // ── Dashboard ──────────────────────────────────────────────

  @Get('dashboard')
  @Roles('BILLING_OFFICER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN')
  dashboard() {
    return this.service.getDashboard();
  }

  @Get('monthly-revenue')
  @Roles('BILLING_OFFICER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN')
  monthlyRevenue() {
    return this.service.monthlyRevenue();
  }

  // ── Invoices ───────────────────────────────────────────────

  @Get()
  @Roles('BILLING_OFFICER', 'CEO', 'OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT', 'SUPER_ADMIN')
  findAll(@Query('status') status?: string, @Query('type') type?: string, @Query('search') search?: string) {
    return this.service.findAll({ status, type, search });
  }

  @Post()
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  create(
    @Body() body: {
      subscriberId?: string;
      newCustomer?: { name?: string; email: string; phone?: string; address?: string };
      type: string;
      dueAt: string;
      lines: { description: string; amountKobo: number; quantity?: number }[];
      vatKobo?: number;
      discountKobo?: number;
      notes?: string;
    },
    @CurrentUser('id') actorId: string,
  ) {
    return this.service.create({
      subscriberId: body.subscriberId,
      newCustomer: body.newCustomer,
      type: body.type as any,
      dueAt: new Date(body.dueAt),
      lines: body.lines,
      vatKobo: body.vatKobo,
      discountKobo: body.discountKobo,
      notes: body.notes,
    }, actorId);
  }

  @Patch(':id/issue')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  issue(
    @Param('id') id: string,
    @Body() body?: { email?: string },
    @CurrentUser('id') actorId: string = 'SYSTEM',
  ) {
    return this.service.issue(id, actorId, body?.email);
  }

  @Patch(':id/void')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  voidInvoice(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.service.voidInvoice(id, actorId);
  }

  @Patch(':id/paid')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  markPaid(
    @Param('id') id: string,
    @Body() body?: { provider?: string; reference?: string; amountKobo?: number },
    @Headers('x-webhook-token') webhookToken?: string,
    @CurrentUser('id') actorId?: string,
  ) {
    const expected = process.env.WEBHOOK_SERVICE_TOKEN;
    if (!expected && process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('WEBHOOK_SERVICE_TOKEN not configured — direct PAID transition disabled');
    }
    if (expected && webhookToken !== expected) {
      throw new ForbiddenException('Direct PAID transition denied — use payment webhook');
    }
    return this.service.markPaid(id, body ? { provider: body.provider!, reference: body.reference!, amountKobo: body.amountKobo! } : undefined, actorId);
  }

  // ── Quotations ─────────────────────────────────────────────

  @Get('quotations')
  @Roles('BILLING_OFFICER', 'SALES_AGENT', 'CEO', 'SUPER_ADMIN')
  listQuotations(@Query('status') status?: string) {
    return this.service.listQuotations({ status });
  }

  @Get('quotations/:id')
  @Roles('BILLING_OFFICER', 'SALES_AGENT', 'CEO', 'SUPER_ADMIN')
  getQuotation(@Param('id') id: string) {
    return this.service.getQuotation(id);
  }

  @Post('quotations')
  @Roles('BILLING_OFFICER', 'SALES_AGENT', 'SUPER_ADMIN')
  createQuotation(@Body() body: {
    subscriberId?: string;
    subscriberName: string;
    subscriberEmail?: string;
    subscriberPhone?: string;
    subscriberAddress?: string;
    validUntil?: string;
    items: { description: string; quantity: number; unitPriceKobo: number }[];
    discountKobo?: number;
    notes?: string;
  }) {
    return this.service.createQuotation({
      ...body,
      validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
    });
  }

  @Patch('quotations/:id/status')
  @Roles('BILLING_OFFICER', 'SALES_AGENT', 'SUPER_ADMIN')
  updateQuotationStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.service.updateQuotationStatus(id, body.status);
  }

  // ── Receipts ───────────────────────────────────────────────

  @Get('receipts')
  @Roles('BILLING_OFFICER', 'CEO', 'CUSTOMER_SUPPORT', 'SUPER_ADMIN')
  listReceipts(@Query('invoiceId') invoiceId?: string) {
    return this.service.listReceipts(invoiceId);
  }

  // ── Payments ───────────────────────────────────────────────

  @Get('payments')
  @Roles('BILLING_OFFICER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN')
  listPayments(@Query('status') status?: string) {
    return this.service.listPayments({ status });
  }

  // ── Credit Notes ───────────────────────────────────────────

  @Post('credit-notes')
  @Roles('BILLING_OFFICER', 'SUPER_ADMIN')
  issueCreditNote(@Body() body: { invoiceId: string; amountKobo: number; reason: string }) {
    return this.service.issueCreditNote(body.invoiceId, body.amountKobo, body.reason);
  }

  // ── Invoice detail + PDF ───────────────────────────────────
  // NOTE: these parameterized routes MUST stay after the static
  // routes above — otherwise "quotations", "payments", "receipts"
  // would be captured as :id and return 404.

  @Get(':id')
  @Roles('BILLING_OFFICER', 'CEO', 'OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT', 'SUPER_ADMIN')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/pdf')
  @Roles('BILLING_OFFICER', 'CEO', 'OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT', 'SUPER_ADMIN')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const pdf = await this.service.invoicePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${pdf.invoiceNumber}.pdf"`,
      'Content-Length': pdf.buffer.length.toString(),
    });
    res.end(pdf.buffer);
  }
}
