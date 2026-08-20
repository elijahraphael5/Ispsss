import { HealthService, HealthProbe, makeLivenessHandler, makeReadinessHandler } from './index';

describe('@isp/health', () => {
  it('liveness always reports ok with uptime', () => {
    const service = new HealthService();
    const report = service.liveness();
    expect(report.status).toBe('ok');
    expect(typeof report.uptimeSeconds).toBe('number');
  });

  it('readiness is ok when all probes pass', async () => {
    const probes: HealthProbe[] = [
      { name: 'database', check: async () => undefined },
      { name: 'redis', check: async () => undefined },
    ];
    const report = await new HealthService(probes).readiness();
    expect(report.status).toBe('ok');
    expect(report.checks).toEqual([
      { name: 'database', status: 'ok' },
      { name: 'redis', status: 'ok' },
    ]);
  });

  it('readiness fails when a probe rejects and includes the error', async () => {
    const probes: HealthProbe[] = [
      { name: 'database', check: async () => Promise.reject(new Error('connection refused')) },
      { name: 'redis', check: async () => undefined },
    ];
    const report = await new HealthService(probes).readiness();
    expect(report.status).toBe('fail');
    expect(report.checks[0]).toEqual({ name: 'database', status: 'fail', error: 'connection refused' });
    expect(report.checks[1]).toEqual({ name: 'redis', status: 'ok' });
  });

  it('readiness is ok with no probes', async () => {
    const report = await new HealthService().readiness();
    expect(report.status).toBe('ok');
    expect(report.checks).toEqual([]);
  });

  it('liveness handler responds with JSON body', async () => {
    const body: string[] = [];
    const res = {
      statusCode: 200,
      setHeader: (_k: string, _v: string) => undefined,
      end: (b: string) => { body.push(b); },
    };
    await makeLivenessHandler(new HealthService())(undefined, res);
    const parsed = JSON.parse(body.join(''));
    expect(parsed.status).toBe('ok');
    expect(typeof parsed.uptimeSeconds).toBe('number');
  });

  it('readiness handler returns 503 when a probe fails', async () => {
    const service = new HealthService([
      { name: 'db', check: async () => Promise.reject(new Error('down')) },
    ]);
    const res = {
      statusCode: 200,
      setHeader: (_k: string, _v: string) => undefined,
      end: (_b: string) => undefined,
    };
    await makeReadinessHandler(service)(undefined, res);
    expect(res.statusCode).toBe(503);
  });

  it('readiness handler returns 200 when healthy', async () => {
    const service = new HealthService([{ name: 'db', check: async () => undefined }]);
    const res = {
      statusCode: 200,
      setHeader: (_k: string, _v: string) => undefined,
      end: (_b: string) => undefined,
    };
    await makeReadinessHandler(service)(undefined, res);
    expect(res.statusCode).toBe(200);
  });
});