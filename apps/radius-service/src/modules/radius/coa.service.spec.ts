import { CoaService } from './coa.service';
import { execFile } from 'child_process';

jest.mock('child_process', () => ({
  __esModule: true,
  execFile: jest.fn(),
}));

const execFileMock = execFile as unknown as jest.Mock;

describe('CoaService', () => {
  let service: CoaService;

  beforeAll(() => {
    process.env.RADIUS_NAS_IP = '192.168.88.1';
    process.env.RADIUS_NAS_PORT = '3799';
    process.env.RADIUS_SHARED_SECRET = 'sekrit';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CoaService();
  });

  it('sends Disconnect-Request with proper radclient args', async () => {
    execFileMock.mockImplementation((_bin, _args, _opts, cb) => cb(null, 'Received Disconnect-ACK\n', ''));
    await service.disconnectSession('ppp_user1');
    expect(execFileMock).toHaveBeenCalledWith(
      'radclient',
      expect.arrayContaining([
        '192.168.88.1:3799',
        'disconnect',
        'User-Name = "ppp_user1"',
        '-s',
        'sekrit',
      ]),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('sends CoA with extra attributes', async () => {
    execFileMock.mockImplementation((_bin, _args, _opts, cb) => cb(null, 'Received CoA-ACK\n', ''));
    await service.sendCoa('ppp_user1', { 'Mikrotik-Rate-Limit': '10M/10M' });
    const args: string[] = execFileMock.mock.calls[0][1];
    expect(args[1]).toBe('coa');
    expect(args[2]).toContain('User-Name = "ppp_user1"');
    expect(args[2]).toContain('Mikrotik-Rate-Limit = "10M/10M"');
  });

  it('never throws when the NAS is unreachable (best-effort)', async () => {
    execFileMock.mockImplementation((_bin, _args, _opts, cb) => cb(new Error('connect ETIMEDOUT')));
    await expect(service.disconnectSession('ppp_user1')).resolves.toBeUndefined();
  });
});