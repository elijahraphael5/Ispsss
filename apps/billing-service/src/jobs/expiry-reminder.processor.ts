import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { MailService } from '../modules/mail/mail.service';

const REMINDER_WINDOW_DAYS = 5;
// Skip re-sending if a reminder already went out recently (job retries / restarts).
const REMINDER_DEDUPE_HOURS = 20;

/**
 * Daily renewal reminders: every customer whose subscription expires within the
 * next 5 days gets one email per day until they renew (or expire), so they can
 * pay before being disconnected.
 */
@Processor('expiry-reminder')
export class ExpiryReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ExpiryReminderProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Expiry reminder run started (job ${job.id})`);

    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 86400000);
    const dedupeBefore = new Date(now.getTime() - REMINDER_DEDUPE_HOURS * 3600000);

    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        expiresAt: { gte: now, lte: windowEnd },
        cancelledAt: null,
        OR: [
          { expiryReminderSentAt: null },
          { expiryReminderSentAt: { lt: dedupeBefore } },
        ],
      },
      include: {
        plan: true,
        subscriber: {
          include: {
            user: { select: { email: true, name: true } },
            invoices: { where: { status: { in: ['ISSUED', 'OVERDUE'] } }, select: { amountKobo: true } },
          },
        },
      },
    });

    let sent = 0;
    let skipped = 0;

    for (const sub of subscriptions) {
      if (!sub.expiresAt) { skipped++; continue; }
      const email = sub.subscriber?.user?.email;
      if (!email || email.endsWith('@local')) { skipped++; continue; }

      const daysLeft = Math.max(1, Math.ceil((sub.expiresAt.getTime() - now.getTime()) / 86400000));
      const outstandingKobo = sub.subscriber.invoices.reduce((sum, inv) => sum + inv.amountKobo, 0);

      const delivered = await this.mail.sendExpiryReminder({
        email,
        customerName: sub.subscriber.user.name || email.split('@')[0],
        planName: sub.plan.name,
        expiresAt: sub.expiresAt,
        daysLeft,
        amountKobo: outstandingKobo > 0 ? outstandingKobo : sub.plan.priceKobo,
        isSuspended: !!sub.suspendedAt,
      });

      if (delivered) {
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { expiryReminderSentAt: now },
        });
        sent++;
      } else {
        skipped++;
      }
    }

    this.logger.log(`Expiry reminders: ${sent} sent, ${skipped} skipped (${subscriptions.length} expiring within ${REMINDER_WINDOW_DAYS} days)`);
  }
}
