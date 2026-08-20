import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Sends CoA (Change-of-Authorization) and Disconnect-Request packets to the
 * NAS (MikroTik RouterOS) using the `radclient` CLI (freeradius-utils).
 *
 * Both operations are best-effort: a missing/unreachable NAS must never
 * break the DB-level change (Auth-Type = Reject / radreply row), which is
 * the source of truth for the next auth/accounting round.
 */
@Injectable()
export class CoaService {
  private readonly logger = new Logger(CoaService.name);

  private get target(): string {
    const ip = process.env.RADIUS_NAS_IP ?? '192.168.5.2';
    const port = process.env.RADIUS_NAS_PORT ?? '3799';
    return `${ip}:${port}`;
  }

  private get secret(): string {
    return process.env.RADIUS_SHARED_SECRET ?? 'testing123';
  }

  private get radclient(): string {
    return process.env.RADCLIENT_BIN ?? 'radclient';
  }

  private get retries(): number {
    return parseInt(process.env.RADCLIENT_RETRIES ?? '1', 10);
  }

  private get timeout(): number {
    return parseInt(process.env.RADCLIENT_TIMEOUT ?? '3', 10);
  }

  private async send(
    request: 'coa' | 'disconnect',
    attributes: Record<string, string>,
  ): Promise<string> {
    const pairs = Object.entries(attributes)
      .map(([name, value]) => `${name} = "${value}"`)
      .join(', ');
    const args = [
      this.target,
      request,
      pairs,
      '-s',
      this.secret,
      '-r',
      String(this.retries),
      '-t',
      String(this.timeout),
    ];
    const { stdout, stderr } = await execFileAsync(this.radclient, args, {
      timeout: (this.timeout + 1) * 1000 * (this.retries + 1),
    });
    return `${stdout}${stderr}`.trim();
  }

  async disconnectSession(username: string): Promise<void> {
    try {
      const out = await this.send('disconnect', { 'User-Name': username });
      this.logger.log(`Disconnect-Request for ${username}: ${out}`);
    } catch (err: any) {
      this.logger.warn(
        `Disconnect-Request for ${username} not delivered: ${err?.message ?? err}`,
      );
    }
  }

  async sendCoa(username: string, attributes: Record<string, string>): Promise<void> {
    try {
      const out = await this.send('coa', { 'User-Name': username, ...attributes });
      this.logger.log(`CoA for ${username}: ${out}`);
    } catch (err: any) {
      this.logger.warn(`CoA for ${username} not delivered: ${err?.message ?? err}`);
    }
  }
}