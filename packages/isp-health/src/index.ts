export interface HealthProbe {
  name: string;
  check: () => Promise<void>;
}

export interface CheckResult {
  name: string;
  status: 'ok' | 'fail';
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'fail';
  checks: CheckResult[];
}

export class HealthService {
  private readonly probes: HealthProbe[];

  constructor(probes: HealthProbe[] = []) {
    this.probes = probes;
  }

  liveness(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  async readiness(): Promise<HealthReport> {
    const checks = await Promise.all(
      this.probes.map(async (probe): Promise<CheckResult> => {
        try {
          await probe.check();
          return { name: probe.name, status: 'ok' };
        } catch (err) {
          return {
            name: probe.name,
            status: 'fail',
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    const ok = checks.every((c) => c.status === 'ok');
    return { status: ok ? 'ok' : 'fail', checks };
  }
}

type Handler = (
  req: unknown,
  res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void },
) => Promise<void>;

export function makeLivenessHandler(service: HealthService): Handler {
  return async (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(service.liveness()));
  };
}

export function makeReadinessHandler(service: HealthService): Handler {
  return async (_req, res) => {
    const report = await service.readiness();
    res.statusCode = report.status === 'ok' ? 200 : 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(report));
  };
}