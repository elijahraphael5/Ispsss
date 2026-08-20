import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../audit-logs/audit.service';
import { PaystackProvider } from './providers/paystack.provider';
import { RadiusClientService } from '../radius/radius-client.service';
import { MailService } from '../mail/mail.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  const prisma = {
    invoice: { findUniqueOrThrow: jest.fn(), findUnique: jest.fn() },
    payment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      groupBy: jest.fn(),
      aggregate: jest.fn(),
    },
    paymentAttempt: { create: jest.fn(), findFirst: jest.fn() },
    subscriber: { findUniqueOrThrow: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    wallet: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    walletTransaction: { create: jest.fn(), findMany: jest.fn() },
    virtualAccount: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), count: jest.fn() },
    refund: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    subscription: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    plan: { findUnique: jest.fn(), findFirst: jest.fn() },
    receipt: { create: jest.fn(), findFirst: jest.fn() },
    paymentReconciliation: { findMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  const billing = { markPaid: jest.fn() };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const paystack = { initializeTransaction: jest.fn(), verifyTransaction: jest.fn() };
  const radius = { activate: jest.fn().mockResolvedValue(undefined), deactivate: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = 'test-secret';
    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: BillingService, useValue: billing },
        { provide: AuditService, useValue: audit },
        { provide: PaystackProvider, useValue: paystack },
        { provide: RadiusClientService, useValue: radius },
        { provide: MailService, useValue: { sendPaymentReceipt: jest.fn(), sendPaymentFailed: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(PaymentsService);
  });

  describe('initialize', () => {
    it('rejects initialization for an already paid invoice', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'inv1', status: 'PAID', amountKobo: 1000 });
      await expect(service.initialize({ invoiceId: 'inv1', email: 'a@b.co' })).rejects.toThrow(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('creates a PENDING payment and initializes the Paystack transaction', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'inv1', status: 'ISSUED', amountKobo: 1000 });
      prisma.payment.create.mockResolvedValue({ id: 'pay1' });
      paystack.initializeTransaction.mockResolvedValue({ authorizationUrl: 'https://paystack.test/checkout', reference: 'PAY-1' });
      prisma.paymentAttempt.create.mockResolvedValue({});
      const result = await service.initialize({ invoiceId: 'inv1', email: 'a@b.co', callbackUrl: 'https://app/cb' });
      expect(result.authorizationUrl).toBe('https://paystack.test/checkout');
      expect(result.paymentId).toBe('pay1');
      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ invoiceId: 'inv1', provider: 'PAYSTACK', amountKobo: 1000, status: 'PENDING' }),
      });
      expect(paystack.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'a@b.co', amountKobo: 1000, callbackUrl: 'https://app/cb' }),
      );
    });

    it('marks payment FAILED when the provider call fails', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'inv1', status: 'ISSUED', amountKobo: 1000 });
      prisma.payment.create.mockResolvedValue({ id: 'pay1' });
      paystack.initializeTransaction.mockRejectedValue(new Error('gateway down'));
      await expect(service.initialize({ invoiceId: 'inv1', email: 'a@b.co' })).rejects.toThrow(BadRequestException);
      expect(prisma.payment.update).toHaveBeenCalledWith({ where: { id: 'pay1' }, data: { status: 'FAILED' } });
    });
  });

  describe('recordOfflinePayment', () => {
    it('delegates to billing.markPaid and audits', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'inv1', status: 'ISSUED' });
      billing.markPaid.mockResolvedValue({ id: 'inv1', status: 'PAID' });
      const result = await service.recordOfflinePayment({ invoiceId: 'inv1', amountKobo: 5000, provider: 'CASH', reference: 'REF-1' });
      expect(billing.markPaid).toHaveBeenCalledWith('inv1', { provider: 'CASH', reference: 'REF-1', amountKobo: 5000 });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'OFFLINE_PAYMENT_RECORDED' }));
      expect(result).toEqual({ id: 'inv1', status: 'PAID' });
    });
  });

  describe('recordPartialPayment', () => {
    it('marks invoice fully paid when cumulative amount reaches the total', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'inv1', status: 'ISSUED', amountKobo: 10000 });
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amountKobo: 6000 } });
      prisma.payment.create.mockResolvedValue({ id: 'payX' });
      const result = await service.recordPartialPayment({ invoiceId: 'inv1', amountKobo: 4000, provider: 'BANK_TRANSFER', reference: 'R2' });
      expect(result).toEqual({ paidKobo: 10000, remainingKobo: 0, fullyPaid: true });
      expect(billing.markPaid).toHaveBeenCalledWith('inv1');
    });

    it('does not mark paid while below total', async () => {
      prisma.invoice.findUniqueOrThrow.mockResolvedValue({ id: 'inv1', status: 'ISSUED', amountKobo: 10000 });
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amountKobo: 1000 } });
      const result = await service.recordPartialPayment({ invoiceId: 'inv1', amountKobo: 2000, provider: 'BANK_TRANSFER', reference: 'R1' });
      expect(result.fullyPaid).toBe(false);
      expect(result.remainingKobo).toBe(7000);
      expect(billing.markPaid).not.toHaveBeenCalled();
    });
  });

  describe('wallet', () => {
    it('creates a zero-balance wallet on first access', async () => {
      prisma.wallet.findUnique.mockResolvedValue(null);
      prisma.wallet.create.mockResolvedValue({ id: 'w1', subscriberId: 's1', balanceKobo: 0 });
      const wallet = await service.getWallet('s1');
      expect(prisma.wallet.create).toHaveBeenCalledWith({ data: { subscriberId: 's1', balanceKobo: 0 } });
      expect(wallet.id).toBe('w1');
    });

    it('credits the wallet atomically with a transaction record', async () => {
      prisma.wallet.findUnique.mockResolvedValue({ id: 'w1', subscriberId: 's1', balanceKobo: 100 });
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          wallet: { update: jest.fn().mockResolvedValue({ id: 'w1', balanceKobo: 600 }) },
          walletTransaction: { create: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });
      const updated = await service.creditWallet('s1', 500, 'REF-C', 'topup');
      expect(updated.balanceKobo).toBe(600);
    });

    it('rejects debit when balance is insufficient', async () => {
      prisma.wallet.findUnique.mockResolvedValue({ id: 'w1', subscriberId: 's1', balanceKobo: 100 });
      await expect(service.debitWallet('s1', 500, 'REF-D')).rejects.toThrow(BadRequestException);
    });
  });

  describe('virtual accounts', () => {
    it('returns the existing active account without creating a new one', async () => {
      prisma.virtualAccount.findFirst.mockResolvedValue({ id: 'va1' });
      const va = await service.assignVirtualAccount('s1');
      expect(va).toEqual({ id: 'va1' });
      expect(prisma.virtualAccount.create).not.toHaveBeenCalled();
    });

    it('rotates banks by count modulo 3', async () => {
      prisma.virtualAccount.findFirst.mockResolvedValue(null);
      prisma.virtualAccount.count.mockResolvedValue(3);
      prisma.subscriber.findUnique.mockResolvedValue({ user: { email: 'jane@x.co' } });
      prisma.virtualAccount.create.mockImplementation(({ data }: any) => Promise.resolve(data));
      const va = await service.assignVirtualAccount('s1');
      expect(va.bankName).toBe('Wema Bank');
      expect(va.accountName).toBe('Hikonnect - jane');
    });
  });

  describe('refunds', () => {
    it('only allows refunding successful payments', async () => {
      prisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 'p1', status: 'PENDING' });
      await expect(service.requestRefund({ paymentId: 'p1', amountKobo: 100 })).rejects.toThrow(BadRequestException);
    });

    it('creates a PENDING refund with the next refund number in sequence', async () => {
      prisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 'p1', status: 'SUCCESSFUL', invoiceId: 'inv1' });
      prisma.refund.findFirst.mockResolvedValue({ refundNumber: `RFN-${new Date().getFullYear()}-000003` });
      prisma.refund.create.mockImplementation(({ data }: any) => Promise.resolve(data));
      const r = await service.requestRefund({ paymentId: 'p1', amountKobo: 200, reason: 'overcharged' });
      expect(r.refundNumber).toBe(`RFN-${new Date().getFullYear()}-000004`);
      expect(r.status).toBe('PENDING');
    });

    it('rejects approving a non-pending refund', async () => {
      prisma.refund.findUniqueOrThrow.mockResolvedValue({ id: 'rf1', status: 'REJECTED' });
      await expect(service.approveRefund('rf1', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('processes an approved refund: refund PROCESSED, payment REFUNDED, invoice VOID', async () => {
      prisma.refund.findUniqueOrThrow.mockResolvedValue({ id: 'rf1', status: 'APPROVED', paymentId: 'p1', invoiceId: 'inv1' });
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          refund: { update: jest.fn().mockResolvedValue({ status: 'PROCESSED' }) },
          payment: { update: jest.fn().mockResolvedValue({ status: 'REFUNDED' }) },
          invoice: { update: jest.fn().mockResolvedValue({ status: 'VOID' }) },
        };
        return cb(tx);
      });
      await service.processRefund('rf1');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'REFUND_PROCESSED' }));
    });

    it('rejects processing an unapproved refund', async () => {
      prisma.refund.findUniqueOrThrow.mockResolvedValue({ id: 'rf1', status: 'PENDING' });
      await expect(service.processRefund('rf1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('webhooks', () => {
    const body = { event: 'charge.success', data: { reference: 'PAY-1', id: '12345' } };
    const signature = crypto.createHmac('sha512', 'test-secret').update(JSON.stringify(body)).digest('hex');

    it('ignores a webhook with an invalid signature', async () => {
      await service.handlePaystackWebhook(body, 'bogus-signature');
      expect(prisma.paymentAttempt.create).not.toHaveBeenCalled();
      expect(billing.markPaid).not.toHaveBeenCalled();
    });

    it('processes charge.success for a known reference and marks the invoice paid', async () => {
      prisma.payment.findUnique.mockResolvedValue({ id: 'p1', invoiceId: 'inv1', amountKobo: 1000 });
      prisma.paymentAttempt.create.mockResolvedValue({});
      prisma.paymentAttempt.findFirst.mockResolvedValue(null);
      prisma.payment.update.mockResolvedValue({});
      billing.markPaid.mockResolvedValue({});
      await service.handlePaystackWebhook(body, signature);
      expect(prisma.paymentAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'SUCCESSFUL', reference: 'PAY-1' }),
      });
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: expect.objectContaining({ status: 'SUCCESSFUL', paidAt: expect.any(Date), providerReference: '12345' }),
      });
      expect(billing.markPaid).toHaveBeenCalledWith('inv1', { provider: 'PAYSTACK', reference: 'PAY-1', amountKobo: 1000 });
    });

    it('routes customer self-service payments through completeCustomerPayment', async () => {
      prisma.payment.findUnique
        .mockResolvedValueOnce({ id: 'p1', invoiceId: 'inv1', amountKobo: 1000 })
        .mockResolvedValue({
          id: 'p1', invoiceId: 'inv1', amountKobo: 1000,
          invoice: { invoiceNumber: 'INV-2026-000001', subscriber: { user: { email: 'cust@x.com', fullName: 'Cust', name: null } } },
        });
      prisma.paymentAttempt.create.mockResolvedValue({});
      prisma.paymentAttempt.findFirst.mockResolvedValue({ response: { meta: { action: 'renew' } } });
      prisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 'p1', invoiceId: 'inv1', amountKobo: 1000, invoice: { subscriberId: 'sub1' } });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.subscription.findFirst.mockResolvedValue({ id: 's1', expiresAt: new Date('2026-01-01'), plan: null });
      prisma.subscription.update.mockResolvedValue({});
      billing.markPaid.mockResolvedValue({});
      jest.spyOn(service as any, 'notifyRadiusActivation').mockResolvedValue(undefined);
      await service.handlePaystackWebhook(body, signature);
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ suspendedAt: null }) }),
      );
      expect(billing.markPaid).toHaveBeenCalledWith('inv1', { provider: 'PAYSTACK', reference: 'PAY-1', amountKobo: 1000 });
      jest.restoreAllMocks();
    });

    it('marks the payment FAILED on charge.failed', async () => {
      const failedBody = { event: 'charge.failed', data: { reference: 'PAY-9' } };
      const failedSig = crypto.createHmac('sha512', 'test-secret').update(JSON.stringify(failedBody)).digest('hex');
      prisma.payment.findUnique
        .mockResolvedValueOnce({ id: 'p9', invoiceId: 'inv9', amountKobo: 1000 })
        .mockResolvedValue({
          id: 'p9', invoiceId: 'inv9', amountKobo: 1000,
          invoice: { invoiceNumber: 'INV-2026-000009', subscriber: { user: { email: 'cust@x.com', fullName: 'Cust', name: null } } },
        });
      prisma.paymentAttempt.create.mockResolvedValue({});
      prisma.payment.update.mockResolvedValue({});
      await service.handlePaystackWebhook(failedBody, failedSig);
      expect(prisma.payment.update).toHaveBeenCalledWith(
        { where: { id: 'p9' }, data: expect.objectContaining({ status: 'FAILED' }) },
      );
      expect(billing.markPaid).not.toHaveBeenCalled();
    });

    it('ignores charge.success for an unknown reference', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      await service.handlePaystackWebhook(body, signature);
      expect(billing.markPaid).not.toHaveBeenCalled();
    });

    it('generic webhook marks payment SUCCESSFUL and delegates to billing', async () => {
      prisma.payment.findUnique.mockResolvedValue({ id: 'p1', invoiceId: 'inv1', amountKobo: 500 });
      prisma.paymentAttempt.create.mockResolvedValue({});
      prisma.payment.update.mockResolvedValue({});
      await service.handleGenericWebhook({ reference: 'PAY-1', status: 'SUCCESSFUL', provider: 'PAYSTACK', providerReference: 'PX-9' });
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: expect.objectContaining({ status: 'SUCCESSFUL', providerReference: 'PX-9' }),
      });
      expect(billing.markPaid).toHaveBeenCalledWith('inv1', expect.objectContaining({ provider: 'PAYSTACK' }));
    });

    it('generic webhook marks payment FAILED without marking the invoice paid', async () => {
      prisma.payment.findUnique.mockResolvedValue({ id: 'p1', invoiceId: 'inv1', amountKobo: 500 });
      prisma.payment.update.mockResolvedValue({});
      await service.handleGenericWebhook({ reference: 'PAY-1', status: 'FAILED', provider: 'PAYSTACK' });
      expect(prisma.payment.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'FAILED' } });
      expect(billing.markPaid).not.toHaveBeenCalled();
    });
  });

  describe('reconciliation', () => {
    it('creates a MATCHED reconciliation when gateway equals bank amount', async () => {
      prisma.paymentReconciliation.create.mockImplementation(({ data }: any) => Promise.resolve(data));
      const r = await service.createReconciliation({ referenceDate: new Date('2026-08-01'), gatewayAmountKobo: 1000, bankAmountKobo: 1000 });
      expect(r.status).toBe('MATCHED');
      expect(r.varianceKobo).toBe(0);
    });

    it('flags a DISCREPANCY when amounts differ', async () => {
      prisma.paymentReconciliation.create.mockImplementation(({ data }: any) => Promise.resolve(data));
      const r = await service.createReconciliation({ referenceDate: new Date('2026-08-01'), gatewayAmountKobo: 1000, bankAmountKobo: 900 });
      expect(r.status).toBe('DISCREPANCY');
      expect(r.varianceKobo).toBe(100);
    });
  });
});