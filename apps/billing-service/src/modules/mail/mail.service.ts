import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private logoBase64 = '';

  constructor(private config: ConfigService) {
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

  private loadLogo(): void {
    try {
      const configuredPath = this.config.get<string>('LOGO_PATH');
      const logoPath = configuredPath
        ? path.resolve(configuredPath)
        : path.join(process.cwd(), 'apps', 'admin', 'public', 'logo.png');

      if (fs.existsSync(logoPath)) {
        const ext = path.extname(logoPath).slice(1);
        this.logoBase64 = `data:image/${ext};base64,${fs.readFileSync(logoPath, 'base64')}`;
        this.logger.log('Logo loaded successfully');
      } else {
        this.logger.warn(`Logo missing at path: ${logoPath}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to load logo: ${(err as Error).message}`);
    }
  }

  private getAppName(): string { return this.config.get<string>('APP_NAME', 'Hikonnect'); }
  private getFrom(): string { return this.config.get<string>('MAIL_FROM', 'noreply@hikonnectng.com'); }

  private fmtKobo(kobo: number): string {
    return '₦' + (kobo / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private h(contentHtml: string, previewText = ''): string {
    const appName = this.getAppName();
    const logoHtml = this.logoBase64
      ? `<img src="${this.logoBase64}" alt="${appName}" width="160" style="max-width:160px;height:auto;border:0;display:block;margin:0 auto;" />`
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

  async send(options: MailOptions): Promise<void> {
    if (!this.transporter) {
      this.logger.warn('Mail skipped — SMTP client missing');
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.getFrom(), ...options });
      this.logger.log(`Mail sent to ${options.to}: "${options.subject}"`);
    } catch (err) {
      this.logger.error(`Failed to send mail to ${options.to}: ${(err as Error).message}`);
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
}
