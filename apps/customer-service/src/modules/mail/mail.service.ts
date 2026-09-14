import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveTenantSmtp } from '@isp/prisma';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';

export interface MailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}

export interface WelcomeData {
  email: string;
  password: string;
  customerId: string;
  planName: string;
  speedMbps: number;
  monthlyCostKobo: number;
  installationFeeKobo: number;
}

export interface ReminderData {
  email: string;
  customerName: string;
  invoiceNumber: string;
  amountKobo: number;
  dueDate: string;
}

export interface DeactivationData {
  email: string;
  customerName: string;
  reason: string;
}

export interface UpgradeData {
  email: string;
  customerName: string;
  oldPlan: string;
  newPlan: string;
  newMonthlyCostKobo: number;
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
  private getAppUrl(): string {
    const url = this.config.get<string>('APP_URL') || this.config.get<string>('CUSTOMER_URL') || 'https://my.hikonnectng.com';
    return /localhost|127\.0\.0\.1/.test(url) ? 'https://my.hikonnectng.com' : url;
  }
  private getFrom(): string {
    if (this.tenantFrom) return this.tenantFrom;
    return this.config.get<string>('MAIL_FROM', 'noreply@hikonnectng.com');
  }

  private fmtKobo(kobo: number): string {
    return '₦' + (kobo / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /**
   * Universal HTML Email Layout Wrapper (Outlook/Mobile Bulletproof)
   */
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
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${appName}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #F1F5F9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
    table { border-collapse: collapse; }
    td { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;">
  <!-- Preheader text for inbox preview -->
  <div style="display:none;font-size:1px;color:#F1F5F9;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${previewText}
  </div>

  <table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1F5F9;width:100%;">
    <tr>
      <td align="center" valign="top" style="padding: 32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);">
          
          <!-- Header -->
          <tr>
            <td align="center" style="background-color:#F15925;padding:24px 32px;">
              ${logoHtml}
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding:32px 32px 24px 32px;">
              ${contentHtml}
            </td>
          </tr>

          <!-- Footer -->
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

  private renderButton(url: string, label: string): string {
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="#F15925" style="border-radius:8px;">
                  <a href="${url}" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;background-color:#F15925;">${label}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`;
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

  async sendWelcome(data: WelcomeData): Promise<void> {
    const cost = this.fmtKobo(data.monthlyCostKobo);
    const install = this.fmtKobo(data.installationFeeKobo);
    const appUrl = this.getAppUrl();
    const name = this.getAppName();

    const body = this.h(
      `<h2 style="margin:0 0 12px 0;font-size:20px;color:#0F172A;font-weight:700;">Welcome to ${name}!</h2>
      <p style="margin:0 0 24px 0;color:#475569;font-size:14px;line-height:1.5;">Your high-speed internet account setup is complete. Review your account details and login credentials below.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid #E2E8F0;">
        <tr><td colspan="2" style="padding-bottom:8px;font-size:12px;font-weight:700;color:#0F172A;text-transform:uppercase;letter-spacing:0.5px;">Account Credentials</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Login Email</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${data.email}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Temporary Password</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-family:monospace;font-size:13px;" align="right">${data.password}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Customer ID</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${data.customerId}</td></tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border-radius:8px;padding:16px;margin-bottom:20px;border:1px solid #E2E8F0;">
        <tr><td colspan="2" style="padding-bottom:8px;font-size:12px;font-weight:700;color:#0F172A;text-transform:uppercase;letter-spacing:0.5px;">Plan Specifications</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Plan Name</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${data.planName}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Speed</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${data.speedMbps} Mbps</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Monthly Subscription</td><td style="padding:4px 0;font-weight:700;color:#F15925;font-size:13px;" align="right">${cost}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Installation Fee</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${install}</td></tr>
        
      </table>

      ${this.renderButton(`${appUrl}/login`, 'Log In to Portal')}

      <p style="margin:0;font-size:12px;color:#94A3B8;text-align:center;">Security notice: Change your temporary password upon initial login.</p>`,
      `Your account is ready. Details for ${data.email}`
    );

    await this.send({ to: data.email, subject: `Welcome to ${name} — Account Activated`, html: body });
  }

  async sendPasswordReset(email: string, newPassword: string): Promise<void> {
    const appUrl = this.getAppUrl();
    const appName = this.getAppName();

    const body = this.h(
      `<h2 style="margin:0 0 12px 0;font-size:20px;color:#0F172A;font-weight:700;">Password Reset</h2>
      <p style="margin:0 0 20px 0;color:#475569;font-size:14px;">Your access credentials were updated per your request.</p>
      
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border-radius:8px;padding:16px;margin-bottom:20px;border:1px solid #E2E8F0;">
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Account</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${email}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">New Password</td><td style="padding:4px 0;font-weight:700;color:#0F172A;font-family:monospace;font-size:14px;" align="right">${newPassword}</td></tr>
      </table>

      ${this.renderButton(`${appUrl}/login`, 'Log In Now')}

      <p style="margin:0;font-size:12px;color:#94A3B8;text-align:center;">If you did not initiate this request, contact support immediately.</p>`,
      `Password reset confirmation for ${email}`
    );

    await this.send({ to: email, subject: `${appName} — Password Reset`, html: body });
  }

  async sendPaymentReminder(data: ReminderData): Promise<void> {
    const amount = this.fmtKobo(data.amountKobo);
    const appUrl = this.getAppUrl();

    const body = this.h(
      `<h2 style="margin:0 0 12px 0;font-size:20px;color:#0F172A;font-weight:700;">Payment Due Reminder</h2>
      <p style="margin:0 0 16px 0;color:#475569;font-size:14px;">Hello ${data.customerName},</p>
      <p style="margin:0 0 20px 0;color:#475569;font-size:14px;line-height:1.5;">Invoice <strong>${data.invoiceNumber}</strong> for <strong>${amount}</strong> is scheduled for payment on <strong>${data.dueDate}</strong>.</p>
      
      ${this.renderButton(`${appUrl}/billing`, 'Pay Invoice')}

      <p style="margin:0;font-size:12px;color:#94A3B8;text-align:center;">Prompt payment ensures uninterrupted service availability.</p>`,
      `Invoice ${data.invoiceNumber} payment reminder`
    );

    await this.send({ to: data.email, subject: `Payment Reminder — Invoice #${data.invoiceNumber}`, html: body });
  }

  async sendDeactivationNotice(data: DeactivationData): Promise<void> {
    const appName = this.getAppName();

    const body = this.h(
      `<h2 style="margin:0 0 12px 0;font-size:20px;color:#DC2626;font-weight:700;">Service Deactivation Notice</h2>
      <p style="margin:0 0 12px 0;color:#475569;font-size:14px;">Hello ${data.customerName},</p>
      <p style="margin:0 0 20px 0;color:#475569;font-size:14px;line-height:1.5;">Your subscription service has been deactivated.</p>
      
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FEF2F2;border-radius:8px;padding:16px;margin-bottom:20px;border:1px solid #FCA5A5;">
        <tr><td style="color:#991B1B;font-size:13px;"><strong>Reason:</strong> ${data.reason}</td></tr>
      </table>

      <p style="margin:0;font-size:13px;color:#64748B;line-height:1.5;">To restore active connection status, resolve pending balances or contact customer service.</p>`,
      `Account deactivation notice for ${data.customerName}`
    );

    await this.send({ to: data.email, subject: `Service Deactivated — ${appName}`, html: body });
  }

  async sendUpgradeConfirmation(data: UpgradeData): Promise<void> {
    const newCost = this.fmtKobo(data.newMonthlyCostKobo);
    const appName = this.getAppName();

    const body = this.h(
      `<h2 style="margin:0 0 12px 0;font-size:20px;color:#0F172A;font-weight:700;">Plan Upgrade Confirmed</h2>
      <p style="margin:0 0 16px 0;color:#475569;font-size:14px;">Hello ${data.customerName},</p>
      <p style="margin:0 0 20px 0;color:#475569;font-size:14px;">Your service plan update request has been processed.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border-radius:8px;padding:16px;margin-bottom:20px;border:1px solid #E2E8F0;">
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Previous Plan</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${data.oldPlan}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">New Plan</td><td style="padding:4px 0;font-weight:700;color:#F15925;font-size:13px;" align="right">${data.newPlan}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">New Monthly Rate</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${newCost}</td></tr>
      </table>

      <p style="margin:0;font-size:13px;color:#64748B;">Speed improvements apply immediately.</p>`,
      `Plan successfully upgraded to ${data.newPlan}`
    );

    await this.send({ to: data.email, subject: `Plan Upgrade Confirmed — ${appName}`, html: body });
  }

  async sendOfficialCommunication(to: string, subject: string, messageHtml: string): Promise<void> {
    const appName = this.getAppName();
    const body = this.h(messageHtml);
    await this.send({ to, subject: `${subject} — ${appName}`, html: body });
  }

  async sendLoginAlert(email: string, ip?: string, userAgent?: string): Promise<void> {
    const appName = this.getAppName();
    const now = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

    const body = this.h(
      `<h2 style="margin:0 0 12px 0;font-size:20px;color:#0F172A;font-weight:700;">New Sign-In Detected</h2>
      <p style="margin:0 0 16px 0;color:#475569;font-size:14px;">A new login was detected on your ${appName} account.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border-radius:8px;padding:16px;margin-bottom:20px;border:1px solid #E2E8F0;">
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Account</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${email}</td></tr>
        <tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Date & Time</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${now}</td></tr>
        ${ip ? `<tr><td style="padding:4px 0;color:#64748B;font-size:13px;">IP Address</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;" align="right">${ip}</td></tr>` : ''}
        ${userAgent ? `<tr><td style="padding:4px 0;color:#64748B;font-size:13px;">Browser</td><td style="padding:4px 0;font-weight:600;color:#0F172A;font-size:13px;word-break:break-word;" align="right">${userAgent}</td></tr>` : ''}
      </table>

      <p style="margin:0;font-size:12px;color:#94A3B8;text-align:center;">If this was you, you can ignore this email. If not, please contact support immediately.</p>`,
      `New sign-in to your ${appName} account`
    );

    await this.send({ to: email, subject: `New Sign-In — ${appName}`, html: body });
  }
}