import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as dgram from 'dgram';

export const ACCESS_REQUEST = 1;
export const ACCESS_ACCEPT = 2;
export const ACCESS_REJECT = 3;

export type NetworkStatus = 'reachable' | 'unreachable' | 'no-response';
export type AuthStatus = 'accept' | 'reject' | 'no-response' | 'error';

export interface UdpProbeResult {
  status: NetworkStatus;
  latencyMs: number | null;
  detail: string;
}

export interface AuthProbeResult {
  status: AuthStatus;
  latencyMs: number | null;
  detail: string;
}

/** RFC 2865 User-Password hiding: XOR the padded password with chained MD5 digests. */
export function encodeUserPassword(password: string, secret: string, authenticator: Buffer): Buffer {
  const pass = Buffer.from(password, 'utf8');
  const length = Math.max(16, Math.ceil(pass.length / 16) * 16);
  const padded = Buffer.alloc(length);
  pass.copy(padded);
  const out = Buffer.alloc(length);
  let prev: Buffer = authenticator;
  const secretBuf = Buffer.from(secret, 'utf8');
  for (let offset = 0; offset < length; offset += 16) {
    const hash = crypto.createHash('md5').update(Buffer.concat([secretBuf, prev])).digest();
    for (let i = 0; i < 16; i++) out[offset + i] = padded[offset + i] ^ hash[i];
    prev = out.subarray(offset, offset + 16);
  }
  return out;
}

/** Builds a minimal RADIUS Access-Request (User-Name + User-Password). */
export function buildAccessRequest(opts: {
  username: string;
  password: string;
  secret: string;
  identifier?: number;
  authenticator?: Buffer;
  nasIp?: string;
}): Buffer {
  const authenticator = opts.authenticator ?? crypto.randomBytes(16);
  const attributes: Buffer[] = [];
  const push = (type: number, value: Buffer) => {
    const attr = Buffer.alloc(2 + value.length);
    attr[0] = type;
    attr[1] = 2 + value.length;
    value.copy(attr, 2);
    attributes.push(attr);
  };

  push(1, Buffer.from(opts.username, 'utf8'));
  push(2, encodeUserPassword(opts.password, opts.secret, authenticator));
  if (opts.nasIp && /^\d{1,3}(\.\d{1,3}){3}$/.test(opts.nasIp)) {
    push(4, Buffer.from(opts.nasIp.split('.').map((n) => Number(n) & 0xff)));
  }

  const body = Buffer.concat(attributes);
  const packet = Buffer.alloc(20 + body.length);
  packet[0] = ACCESS_REQUEST;
  packet[1] = opts.identifier ?? crypto.randomInt(0, 256);
  packet.writeUInt16BE(20 + body.length, 2);
  authenticator.copy(packet, 4);
  body.copy(packet, 20);
  return packet;
}

/**
 * UDP reachability + RADIUS auth probes for the NOC connectivity check.
 * No secrets are logged; results only describe status and latency.
 */
@Injectable()
export class RadiusConnectivityService {
  private readonly logger = new Logger(RadiusConnectivityService.name);

  /**
   * Sends a single UDP datagram and classifies the outcome:
   * - `reachable`: a reply arrived or the host answered with ICMP port-unreachable
   * - `unreachable`: ICMP host/network unreachable or a send error
   * - `no-response`: no reply within the timeout (filtered / silently dropped)
   */
  udpProbe(host: string, port: number, timeoutMs = 2000): Promise<UdpProbeResult> {
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      const started = Date.now();
      let settled = false;

      const finish = (status: NetworkStatus, detail: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch { /* already closed */ }
        resolve({ status, latencyMs: status === 'no-response' ? null : Date.now() - started, detail });
      };

      const timer = setTimeout(() => finish('no-response', 'No reply within timeout (filtered or silent)'), timeoutMs);

      socket.on('message', () => finish('reachable', 'UDP response received'));
      socket.on('error', (err: any) => {
        const code = err?.code;
        if (code === 'ECONNREFUSED') finish('reachable', 'Host reachable (ICMP port unreachable)');
        else if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') finish('unreachable', `Network unreachable (${code})`);
        else finish('unreachable', err?.message ?? String(err));
      });
      socket.send(Buffer.from([0]), port, host, (err) => {
        if (err) finish('unreachable', err.message);
      });
    });
  }

  /**
   * Sends a RADIUS Access-Request to a RADIUS server and reports the reply.
   * `reject` is still a healthy signal: the server is up and the shared secret
   * matched (a secret mismatch is silently dropped → `no-response`).
   */
  authProbe(opts: {
    host: string;
    port: number;
    secret: string;
    username: string;
    password: string;
    timeoutMs?: number;
  }): Promise<AuthProbeResult> {
    const timeoutMs = opts.timeoutMs ?? 3000;
    const packet = buildAccessRequest({
      username: opts.username,
      password: opts.password,
      secret: opts.secret,
    });

    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      const started = Date.now();
      let settled = false;

      const finish = (status: AuthStatus, detail: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch { /* already closed */ }
        resolve({ status, latencyMs: status === 'no-response' ? null : Date.now() - started, detail });
      };

      const timer = setTimeout(
        () => finish('no-response', 'No response — check the shared secret and that FreeRADIUS is running'),
        timeoutMs,
      );

      socket.on('error', (err: any) => finish('error', err?.message ?? String(err)));
      socket.on('message', (msg) => {
        if (msg.length < 20) return finish('error', 'Malformed RADIUS response');
        const code = msg[0];
        if (code === ACCESS_ACCEPT) finish('accept', 'Access-Accept');
        else if (code === ACCESS_REJECT) finish('reject', 'Access-Reject (server up; probe user rejected)');
        else finish('error', `Unexpected RADIUS response code ${code}`);
      });
      socket.send(packet, opts.port, opts.host, (err) => {
        if (err) finish('error', err.message);
      });
    });
  }
}
