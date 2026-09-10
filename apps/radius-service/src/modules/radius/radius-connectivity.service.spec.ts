import * as crypto from 'crypto';
import * as dgram from 'dgram';
import { RadiusConnectivityService, buildAccessRequest, encodeUserPassword, ACCESS_REQUEST, ACCESS_ACCEPT, ACCESS_REJECT } from './radius-connectivity.service';

describe('RadiusConnectivityService', () => {
  let service: RadiusConnectivityService;

  beforeEach(() => {
    service = new RadiusConnectivityService();
  });

  describe('packet helpers', () => {
    it('builds an Access-Request with User-Name and encrypted User-Password', () => {
      const authenticator = Buffer.alloc(16, 7);
      const packet = buildAccessRequest({
        username: 'probe-user',
        password: 'hunter2',
        secret: 's3cret',
        identifier: 42,
        authenticator,
      });

      expect(packet[0]).toBe(ACCESS_REQUEST);
      expect(packet[1]).toBe(42);
      expect(packet.readUInt16BE(2)).toBe(packet.length);
      expect(packet.subarray(4, 20).equals(authenticator)).toBe(true);
      expect(packet[20]).toBe(1); // User-Name attribute
      expect(packet.subarray(22, 22 + packet[21] - 2).toString('utf8')).toBe('probe-user');
    });

    it('hides the password with the RFC 2865 chained-MD5 scheme', () => {
      const secret = 's3cret';
      const authenticator = crypto.randomBytes(16);
      const encrypted = encodeUserPassword('hunter2', secret, authenticator);

      // Decrypt with the same algorithm to prove round-trip.
      const decrypted = Buffer.alloc(encrypted.length);
      let prev: Buffer = authenticator;
      for (let offset = 0; offset < encrypted.length; offset += 16) {
        const hash = crypto.createHash('md5').update(Buffer.concat([Buffer.from(secret), prev])).digest();
        for (let i = 0; i < 16; i++) decrypted[offset + i] = encrypted[offset + i] ^ hash[i];
        prev = encrypted.subarray(offset, offset + 16);
      }

      expect(decrypted.toString('utf8').replace(/\0+$/, '')).toBe('hunter2');
    });
  });

  describe('udpProbe', () => {
    it('reports reachable when a UDP reply arrives', async () => {
      const server = dgram.createSocket('udp4');
      server.on('message', (_msg, rinfo) => server.send(Buffer.from('pong'), rinfo.port, rinfo.address));
      await new Promise<void>((resolve) => server.bind(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;

      const result = await service.udpProbe('127.0.0.1', port, 1000);

      expect(result.status).toBe('reachable');
      expect(result.latencyMs).not.toBeNull();
      server.close();
    });

    it('reports no-response when nothing replies', async () => {
      const server = dgram.createSocket('udp4');
      await new Promise<void>((resolve) => server.bind(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;

      const result = await service.udpProbe('127.0.0.1', port, 300);

      expect(result.status).toBe('no-response');
      expect(result.latencyMs).toBeNull();
      server.close();
    });
  });

  describe('authProbe', () => {
    const startServer = (code: number) => {
      const server = dgram.createSocket('udp4');
      server.on('message', (msg, rinfo) => {
        const reply = Buffer.alloc(20);
        reply[0] = code;
        reply[1] = msg[1];
        reply.writeUInt16BE(20, 2);
        server.send(reply, rinfo.port, rinfo.address);
      });
      return server;
    };

    it('reports accept for an Access-Accept', async () => {
      const server = startServer(ACCESS_ACCEPT);
      await new Promise<void>((resolve) => server.bind(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;

      const result = await service.authProbe({
        host: '127.0.0.1',
        port,
        secret: 's3cret',
        username: 'probe-user',
        password: 'hunter2',
      });

      expect(result.status).toBe('accept');
      expect(result.latencyMs).not.toBeNull();
      server.close();
    });

    it('reports reject for an Access-Reject (server up, secret valid)', async () => {
      const server = startServer(ACCESS_REJECT);
      await new Promise<void>((resolve) => server.bind(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;

      const result = await service.authProbe({
        host: '127.0.0.1',
        port,
        secret: 's3cret',
        username: 'probe-user',
        password: 'wrong',
      });

      expect(result.status).toBe('reject');
      server.close();
    });

    it('reports no-response when the RADIUS server is silent', async () => {
      const server = dgram.createSocket('udp4');
      await new Promise<void>((resolve) => server.bind(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;

      const result = await service.authProbe({
        host: '127.0.0.1',
        port,
        secret: 's3cret',
        username: 'probe-user',
        password: 'hunter2',
        timeoutMs: 300,
      });

      expect(result.status).toBe('no-response');
      server.close();
    });
  });
});
