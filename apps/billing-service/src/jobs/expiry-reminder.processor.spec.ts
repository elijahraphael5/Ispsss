import { ExpiryReminderProcessor } from './expiry-reminder.processor';

describe('ExpiryReminderProcessor', () => {
  const prisma = {
    subscription: { findMany: jest.fn(), update: jest.fn() },
  };
  const mail = { sendExpiryReminder: jest.fn() };
  let processor: ExpiryReminderProcessor;

  const sub = (overrides: any = {}) => ({
    id: 'sub1',
    expiresAt: new Date(Date.now() + 3 * 86400000),
    suspendedAt: null,
    plan: { name: 'Home Gold', priceKobo: 2500000 },
    subscriber: { user: { email: 'cust@x.co', name: 'Ada' }, invoices: [] },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new ExpiryReminderProcessor(prisma as any, mail as any);
    prisma.subscription.update.mockResolvedValue({});
  });

  it('queries subscriptions expiring within 5 days and not already reminded', async () => {
    prisma.subscription.findMany.mockResolvedValue([]);
    await processor.process({ id: 'job1' } as any);
    const args = prisma.subscription.findMany.mock.calls[0][0];
    expect(args.where.cancelledAt).toBeNull();
    expect(args.where.expiresAt.gte).toBeInstanceOf(Date);
    expect(args.where.expiresAt.lte).toBeInstanceOf(Date);
    expect(args.where.OR).toHaveLength(2);
  });

  it('emails each expiring subscriber and stamps the reminder time', async () => {
    prisma.subscription.findMany.mockResolvedValue([sub()]);
    mail.sendExpiryReminder.mockResolvedValue(true);

    await processor.process({ id: 'job1' } as any);

    expect(mail.sendExpiryReminder).toHaveBeenCalledWith(expect.objectContaining({
      email: 'cust@x.co',
      customerName: 'Ada',
      planName: 'Home Gold',
      daysLeft: 3,
      amountKobo: 2500000,
      isSuspended: false,
    }));
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub1' },
      data: { expiryReminderSentAt: expect.any(Date) },
    });
  });

  it('uses the outstanding invoice total as the amount due when present', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      sub({ subscriber: { user: { email: 'cust@x.co', name: 'Ada' }, invoices: [{ amountKobo: 1000000 }, { amountKobo: 500000 }] } }),
    ]);
    mail.sendExpiryReminder.mockResolvedValue(true);

    await processor.process({ id: 'job1' } as any);

    expect(mail.sendExpiryReminder).toHaveBeenCalledWith(expect.objectContaining({ amountKobo: 1500000 }));
  });

  it('flags suspended subscriptions in the reminder', async () => {
    prisma.subscription.findMany.mockResolvedValue([sub({ suspendedAt: new Date() })]);
    mail.sendExpiryReminder.mockResolvedValue(true);

    await processor.process({ id: 'job1' } as any);

    expect(mail.sendExpiryReminder).toHaveBeenCalledWith(expect.objectContaining({ isSuspended: true }));
  });

  it('skips @local addresses and does not stamp them', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      sub({ subscriber: { user: { email: 'ghost@local', name: null }, invoices: [] } }),
    ]);

    await processor.process({ id: 'job1' } as any);

    expect(mail.sendExpiryReminder).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('does not stamp when delivery fails so the next run retries', async () => {
    prisma.subscription.findMany.mockResolvedValue([sub()]);
    mail.sendExpiryReminder.mockResolvedValue(false);

    await processor.process({ id: 'job1' } as any);

    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });
});
