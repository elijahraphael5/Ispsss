import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'isp_' });

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests handled by the service',
  labelNames: ['method', 'path', 'status'] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export interface HttpRequestLabels {
  method: string;
  path: string;
  status: number;
}

export function recordHttpRequest(labels: HttpRequestLabels, durationMs: number): void {
  httpRequestsTotal.inc(labels);
  httpRequestDurationSeconds.observe(labels, durationMs / 1000);
}

export async function metricsText(): Promise<string> {
  return registry.metrics();
}

export function metricsContentType(): string {
  return registry.contentType;
}

export function makeMetricsMiddleware() {
  return async (
    _req: unknown,
    res: { setHeader: (k: string, v: string) => void; end: (b: string) => void },
  ): Promise<void> => {
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  };
}