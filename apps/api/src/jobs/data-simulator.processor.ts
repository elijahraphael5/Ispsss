import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Processor('data-simulator')
export class DataSimulatorProcessor extends WorkerHost {
  private readonly logger = new Logger(DataSimulatorProcessor.name);

  private cycleCount = 0;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.cycleCount++;
    this.logger.log(`Simulation cycle ${this.cycleCount} started (job ${job.id})`);

    try {
      await this.rotateSessions();
      await this.addBandwidth();
      await this.toggleDevices();
      if (this.cycleCount % 5 === 0) await this.createDemoInvoice();
      if (this.cycleCount % 3 === 0) await this.processPayment();
    } catch (err) {
      this.logger.error('Simulation error', err);
    }

    this.logger.log(`Simulation cycle ${this.cycleCount} complete`);
  }

  private async rotateSessions() {
    const activeSessions = await this.prisma.pppoeSession.findMany({
      where: { isActive: true },
      take: 50,
    });

    if (activeSessions.length < 3) {
      await this.createNewSessions(3);
      return;
    }

    const toDisconnect = activeSessions.sort(() => Math.random() - 0.5).slice(0, Math.min(2, activeSessions.length));
    for (const sess of toDisconnect) {
      const duration = Math.round((Date.now() - (sess.startTime?.getTime() ?? Date.now())) / 1000);
      await this.prisma.pppoeSession.update({
        where: { id: sess.id },
        data: { isActive: false, sessionDuration: duration },
      });
    }

    await this.createNewSessions(3);
  }

  private async createNewSessions(count: number) {
    const offlineSubs = await this.prisma.subscriber.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      take: 50,
    });
    if (offlineSubs.length === 0) return;

    const onlineUsernames = (await this.prisma.pppoeSession.findMany({
      where: { isActive: true },
      select: { username: true },
    })).map(s => s.username);

    const available = offlineSubs.filter(s => !onlineUsernames.includes(s.id.slice(0, 8)));
    if (available.length === 0) return;

    const toConnect = available.sort(() => Math.random() - 0.5).slice(0, Math.min(count, available.length));
    const nasDevices = await this.prisma.networkDevice.findMany({ take: 5 });
    const profiles = ['Basic-5Mbps', 'Standard-10Mbps', 'Premium-25Mbps', 'Business-50Mbps'];
    const now = new Date();

    for (const sub of toConnect) {
      const username = sub.id.slice(0, 8);
      const sessionId = `session-live-${username}-${Date.now()}`;
      const nas = nasDevices[Math.floor(Math.random() * nasDevices.length)];
      const profile = profiles[Math.floor(Math.random() * profiles.length)];

      await this.prisma.pppoeSession.create({
        data: {
          username,
          sessionId,
          nasIpAddress: nas?.ipAddress ?? '10.0.0.1',
          nasName: nas?.name ?? 'MikroTik-BRAS1',
          callingStationId: `00:${this.r2()}:${this.r2()}:${this.r2()}:${this.r2()}:${this.r2()}`,
          framedIpAddress: `10.10.${this.r()}.${this.r()}`,
          profile,
          startTime: now,
          sessionDuration: 0,
          downloadBytes: 0n,
          uploadBytes: 0n,
          downloadRate: Math.floor(Math.random() * 80) + 5,
          uploadRate: Math.floor(Math.random() * 40) + 2,
          subscriberId: sub.id,
          isActive: true,
        },
      });
    }
  }

  private async addBandwidth() {
    const activeSessions = await this.prisma.pppoeSession.findMany({
      where: { isActive: true },
      take: 50,
    });

    for (const sess of activeSessions) {
      const dlDelta = BigInt(Math.floor(Math.random() * 500 + 10)) * BigInt(1024 * 1024);
      const ulDelta = BigInt(Math.floor(Math.random() * 100 + 5)) * BigInt(1024 * 1024);
      const newDl = (sess.downloadBytes ?? 0n) + dlDelta;
      const newUl = (sess.uploadBytes ?? 0n) + ulDelta;
      const newDuration = (sess.sessionDuration ?? 0) + 60;

      await this.prisma.pppoeSession.update({
        where: { id: sess.id },
        data: {
          downloadBytes: newDl,
          uploadBytes: newUl,
          sessionDuration: newDuration,
          lastSyncedAt: new Date(),
        },
      });
    }
  }

  private async toggleDevices() {
    if (this.cycleCount % 7 !== 0) return;
    const devices = await this.prisma.networkDevice.findMany({ take: 10 });
    if (devices.length === 0) return;
    const device = devices[Math.floor(Math.random() * devices.length)];
    const newStatus = device.status === 'ONLINE' ? 'WARNING' : 'ONLINE';
    await this.prisma.networkDevice.update({
      where: { id: device.id },
      data: { status: newStatus, cpu: Math.random() * 100, memory: Math.random() * 100 },
    });
  }

  private async createDemoInvoice() {
    const activeSubs = await this.prisma.subscriber.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      take: 20,
    });
    if (activeSubs.length === 0) return;

    const sub = activeSubs[Math.floor(Math.random() * activeSubs.length)];
    const plans = await this.prisma.plan.findMany({ take: 10 });
    if (plans.length === 0) return;
    const plan = plans[Math.floor(Math.random() * plans.length)];
    const year = new Date().getFullYear();
    const count = await this.prisma.invoice.count();
    const invoiceNumber = `INV-${year}-${String(count + 1).padStart(6, '0')}`;
    const priceKobo = plan.priceKobo;
    const vatKobo = Math.round(priceKobo * 0.075);
    const dueAt = new Date(Date.now() + 14 * 86400000);

    await this.prisma.invoice.create({
      data: {
        invoiceNumber,
        subscriberId: sub.id,
        type: 'SUBSCRIPTION',
        status: 'DRAFT',
        amountKobo: priceKobo + vatKobo,
        subtotalKobo: priceKobo,
        vatKobo,
        discountKobo: 0,
        dueAt,
        lines: {
          create: {
            description: `${plan.name} — ${plan.speedMbps}Mbps (Auto-generated)`,
            amountKobo: priceKobo,
            quantity: 1,
          },
        },
      },
    });
  }

  private async processPayment() {
    const issuedInvoices = await this.prisma.invoice.findMany({
      where: { status: 'ISSUED' },
      include: { subscriber: true },
      take: 10,
    });
    if (issuedInvoices.length === 0) return;

    const inv = issuedInvoices[Math.floor(Math.random() * issuedInvoices.length)];
    const year = new Date().getFullYear();
    const ref = `PAY-LIVE-${year}-${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`;
    const recCount = await this.prisma.receipt.count();
    const receiptNumber = `RCT-${year}-${String(recCount + 1).padStart(6, '0')}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          invoiceId: inv.id,
          provider: 'PAYSTACK',
          reference: ref,
          amountKobo: inv.amountKobo,
          status: 'SUCCESSFUL',
          paidAt: new Date(),
        },
      });
      await tx.receipt.create({
        data: {
          receiptNumber,
          invoiceId: inv.id,
          amountKobo: inv.amountKobo,
          paymentMethod: 'PAYSTACK',
          transactionRef: ref,
          paidAt: new Date(),
        },
      });
      await tx.invoice.update({
        where: { id: inv.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
    });
  }

  private r() { return Math.floor(Math.random() * 254) + 1; }
  private r2() { return String(Math.floor(Math.random() * 100)).padStart(2, '0'); }
}
