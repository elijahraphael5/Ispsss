import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveTenantSmtp } from '@isp/prisma';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: MailAttachment[];
}

export interface InvoiceMailData {
  email: string;
  customerName: string;
  invoiceNumber: string;
  amountKobo: number;
  dueAt?: string;
  pdf: Buffer;
}

export interface QuotationMailData {
  email: string;
  customerName: string;
  quotationNumber: string;
  totalKobo: number;
  validUntil?: string;
  pdf: Buffer;
}

export interface ExpiryReminderData {
  email: string;
  customerName: string;
  planName: string;
  expiresAt: Date;
  daysLeft: number;
  amountKobo: number;
  isSuspended?: boolean;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private logoBuffer: Buffer | null = null;
  private logoMime = 'image/png';
  private tenantTransporter: nodemailer.Transporter | null = null;
  private tenantTransportSig = '';
  private tenantFrom: string | null = null;

  constructor(private config: ConfigService, private prisma: PrismaService) {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT', 587);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: Number(port) === 465,
        auth: { user, pass },
      });
      this.logger.log(`SMTP configured: ${host}:${port} as ${user}`);
    } else {
      this.logger.warn('SMTP not configured — mail service disabled');
    }

    this.loadLogo();
  }

  private async resolveTransport(): Promise<nodemailer.Transporter | null> {
    try {
      const smtp = await resolveTenantSmtp(this.prisma, (await this.prisma.tenant.findFirst())?.id);
      if (smtp) {
        const sig = smtp.host + ':' + smtp.port + ':' + smtp.user + ':' + smtp.pass.slice(-4);
        if (!this.tenantTransporter || this.tenantTransportSig !== sig) {
          this.tenantTransporter = nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: Number(smtp.port) === 465,
            auth: { user: smtp.user, pass: smtp.pass },
          });
          this.tenantTransportSig = sig;
          this.tenantFrom = smtp.fromEmail ? (smtp.fromName ? smtp.fromName + ' <' + smtp.fromEmail + '>' : smtp.fromEmail) : null;
          this.logger.log('SMTP resolved from settings: ' + smtp.host + ':' + smtp.port);
        }
        return this.tenantTransporter;
      }
    } catch {
      // fall back to env
    }
    return this.transporter;
  }

  private loadLogo(): void {
    try {
      const configuredPath = this.config.get<string>('LOGO_PATH');
      const candidates = [
        configuredPath ? path.resolve(configuredPath) : null,
        path.join(process.cwd(), 'apps', 'admin', 'public', 'logo.png'),
        path.join(process.cwd(), '..', 'admin', 'public', 'logo.png'),
        path.join(__dirname, '..', '..', '..', '..', '..', 'apps', 'admin', 'public', 'logo.png'),
        path.join(__dirname, '..', '..', '..', '..', 'apps', 'admin', 'public', 'logo.png'),
      ].filter(Boolean) as string[];

      const logoPath = candidates.find((p) => fs.existsSync(p));
      if (logoPath) {
        const ext = path.extname(logoPath).slice(1).toLowerCase();
        this.logoBuffer = fs.readFileSync(logoPath);
        this.logoMime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : 'image/png';
        this.logger.log(`Logo loaded from ${logoPath}`);
      } else {
        this.logger.warn(`Logo missing — tried: ${candidates.join(', ')}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to load logo: ${(err as Error).message}`);
    }
  }

  private getAppName(): string { return this.config.get<string>('APP_NAME', 'Hikonnect'); }
  private getFrom(): string {
    if (this.tenantFrom) return this.tenantFrom;
    return this.config.get<string>('MAIL_FROM', 'noreply@hikonnectng.com');
  }
  private getAppUrl(): string {
    const url = this.config.get<string>('APP_URL') || this.config.get<string>('CUSTOMER_URL') || 'https://my.hikonnectng.com';
    return /localhost|127\.0\.0\.1/.test(url) ? 'https://my.hikonnectng.com' : url;
  }

  private renderButton(url: string, label: string): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 20px auto;">
      <tr><td style="border-radius:24px;background-color:#F15925;">
        <a href="${url}" target="_blank" style="display:inline-block;padding:13px 32px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:24px;">${label}</a>
      </td></tr>
    </table>`;
  }

  private fmtKobo(kobo: number): string {
    return '₦' + (kobo / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private h(contentHtml: string, previewText = ''): string {
    const appName = this.getAppName();
    const logoHtml = this.logoBuffer
      ? `<img src="cid:hikonnect-logo" alt="${appName}" width="160" style="max-width:160px;height:auto;border:0;display:block;margin:0 auto;" />`
      : `<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">${appName}</h1>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName}</title>
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;">
  <div style="display:none;font-size:1px;color:#F1F5F9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${previewText}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1F5F9;width:100%;">
    <tr>
      <td align="center" valign="top" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
          <tr>
            <td align="center" style="background-color:#F15925;padding:24px 32px;">${logoHtml}</td>
          </tr>
          <tr>
            <td style="padding:32px 32px 24px 32px;">${contentHtml}</td>
          </tr>
          <tr>
            <td style="background-color:#F8FAFC;padding:24px 32px;border-top:1px solid #E2E8F0;text-align:center;">
              <p style="margin:0 0 6px 0;font-size:12px;color:#64748B;font-weight:600;">${appName} Nigeria</p>
              <p style="margin:0;font-size:12px;color:#94A3B8;">Need help? Contact <a href="mailto:support@hikonnectng.com" style="color:#F15925;text-decoration:none;">support@hikonnectng.com</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Returns true when the mail was actually handed to the SMTP server.
   * Errors are logged, not thrown, so fire-and-forget callers keep working.
   */
  /**
   * Fire-and-forget send: starts the task immediately and returns, logging any
   * failure. Callers never block on SMTP and never see an unhandled rejection.
   */
  enqueue(task: () => Promise<unknown>): void {
    try {
      void task().catch((err) => this.logger.error(`Async mail failed: ${(err as Error).message}`));
    } catch (err) {
      this.logger.error(`Async mail failed: ${(err as Error).message}`);
    }
  }

  async send(options: MailOptions): Promise<boolean> {
    const transporter = await this.resolveTransport();
    if (!transporter) {
      this.logger.warn('Mail skipped — SMTP client missing');
      return false;
    }
    try {
      await transporter.sendMail({
        from: this.getFrom(),
        ...options,
        ...(this.logoBuffer ? { attachments: [{ filename: 'logo.png', content: this.logoBuffer, cid: 'hikonnect-logo' }] } : {}),
      });
      this.logger.log(`Mail sent to ${options.to}: "${options.subject}"`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to send mail to ${options.to}: ${(err as Error).message}`);
      return false;
    }
  }

  async sendInvoiceEmail(data: InvoiceMailData): Promise<void> {
    const amount = this.fmtKobo(data.amountKobo);
    const due = data.dueAt ? new Date(data.dueAt).toLocaleDateString('en-GB') : '—';

    const body = this.h(
      `<h2 style="margin:0 0 12px 0;font-size:20px;color:#0F172A;font-weight:700;">Invoice ${data.invoiceNumber}</h2>
      <p style="margin:0 0 16px 0;color:#475569;font-size:14px;">Hello ${data.customerName},</p>
      <p style="margin:0 0 20px 0;color:#475569;font-size:14px;line-height:1.5;">Please find attached your invoice <strong>${data.invoiceNumber}</strong> for <strong>${amount}</strong>, due on <strong>${due}</strong>.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border-radius:8px;padding:16px;margin-bottom:20px;border:1px solid #E2E8F0;">
        <tr><td colspan="2" style="padding-bottom:8px;font-size:12px;font-weight:700;color:#0F172A;text-transform:uppercase;letter-spacing:0.5px;">Invoice Details</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Invoice Number</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${data.invoiceNumber}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Amount Due</td><td style="padding:4px 0;font-weight:700;color:#F15925;font-size:13px;" align="right">${amount}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Due Date</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${due}</td></tr>
      </table>

      <p style="margin:0;font-size:13px;color:#64748B;">The PDF attachment contains the full breakdown of charges. Prompt payment ensures uninterrupted service.</p>`,
      `Invoice ${data.invoiceNumber} for ${amount}`
    );

    await this.send({
      to: data.email,
      subject: `Invoice ${data.invoiceNumber} — ${this.getAppName()}`,
      html: body,
      attachments: [{ filename: `invoice-${data.invoiceNumber}.pdf`, content: data.pdf, contentType: 'application/pdf' }],
    });
  }

  async sendQuotationEmail(data: QuotationMailData): Promise<void> {
    const total = this.fmtKobo(data.totalKobo);
    const valid = data.validUntil ? new Date(data.validUntil).toLocaleDateString('en-GB') : '—';

    const body = this.h(
      `<h2 style="margin:0 0 12px 0;font-size:20px;color:#0F172A;font-weight:700;">Quotation ${data.quotationNumber}</h2>
      <p style="margin:0 0 16px 0;color:#475569;font-size:14px;">Hello ${data.customerName},</p>
      <p style="margin:0 0 20px 0;color:#475569;font-size:14px;line-height:1.5;">Please find attached quotation <strong>${data.quotationNumber}</strong> with a total of <strong>${total}</strong>, valid until <strong>${valid}</strong>.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border-radius:8px;padding:16px;margin-bottom:20px;border:1px solid #E2E8F0;">
        <tr><td colspan="2" style="padding-bottom:8px;font-size:12px;font-weight:700;color:#0F172A;text-transform:uppercase;letter-spacing:0.5px;">Quotation Details</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Quotation Number</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${data.quotationNumber}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Total</td><td style="padding:4px 0;font-weight:700;color:#F15925;font-size:13px;" align="right">${total}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Valid Until</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${valid}</td></tr>
      </table>

      <p style="margin:0;font-size:13px;color:#64748B;">The PDF attachment contains the full breakdown. Accept the quotation to proceed with setup.</p>`,
      `Quotation ${data.quotationNumber} for ${total}`
    );

    await this.send({
      to: data.email,
      subject: `Quotation ${data.quotationNumber} — ${this.getAppName()}`,
      html: body,
      attachments: [{ filename: `quotation-${data.quotationNumber}.pdf`, content: data.pdf, contentType: 'application/pdf' }],
    });
  }

  /**
   * Daily "your subscription expires soon" reminder — sent every day during the
   * 5 days before expiry so the customer pays before being disconnected.
   */
  async sendExpiryReminder(data: ExpiryReminderData): Promise<boolean> {
    const appUrl = this.getAppUrl();
    const expires = data.expiresAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const amount = this.fmtKobo(data.amountKobo);
    const dayWord = data.daysLeft === 1 ? 'day' : 'days';
    const urgency = data.daysLeft <= 1
      ? 'Your subscription expires <strong>today</strong>'
      : `Your subscription expires in <strong>${data.daysLeft} ${dayWord}</strong>`;

    const body = this.h(
      `<h2 style="margin:0 0 12px 0;font-size:20px;color:#0F172A;font-weight:700;">Payment reminder</h2>
      <p style="margin:0 0 16px 0;color:#475569;font-size:14px;">Hello ${data.customerName},</p>
      <p style="margin:0 0 20px 0;color:#475569;font-size:14px;line-height:1.5;">${urgency} on <strong>${expires}</strong>. To avoid disconnection, please renew your plan as soon as possible.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border-radius:8px;padding:16px;margin-bottom:20px;border:1px solid #E2E8F0;">
        <tr><td colspan="2" style="padding-bottom:8px;font-size:12px;font-weight:700;color:#0F172A;text-transform:uppercase;letter-spacing:0.5px;">Renewal Details</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Plan</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${data.planName}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Expiry Date</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${expires}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Amount Due</td><td style="padding:4px 0;font-weight:700;color:#F15925;font-size:13px;" align="right">${amount}</td></tr>
      </table>

      ${this.renderButton(`${appUrl}/subscription`, 'Renew / Pay Now')}
      <p style="margin:0;font-size:13px;color:#64748B;text-align:center;">${data.isSuspended ? 'Your service is currently suspended — renew now to be reconnected.' : 'You are receiving this because your subscription is due for renewal. Please ignore if you have already paid.'}</p>`,
      `Your ${data.planName} plan expires in ${data.daysLeft} ${dayWord}`
    );

    return this.send({
      to: data.email,
      subject: `${data.daysLeft <= 1 ? 'Action required: ' : ''}Your ${data.planName} plan expires in ${data.daysLeft} ${dayWord} — ${this.getAppName()}`,
      html: body,
    });
  }
}
