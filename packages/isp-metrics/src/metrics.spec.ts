import {
  metricsText,
  metricsContentType,
  makeMetricsMiddleware,
  recordHttpRequest,
  httpRequestsTotal,
  httpRequestDurationSeconds,
} from './index';

describe('@isp/metrics', () => {
  beforeEach(() => {
    httpRequestsTotal.reset();
    httpRequestDurationSeconds.reset();
  });

  it('records request counts with labels and exposes them in prometheus format', async () => {
    recordHttpRequest({ method: 'POST', path: '/auth/login', status: 200 }, 12.5);
    recordHttpRequest({ method: 'POST', path: '/auth/login', status: 401 }, 3.1);
    const text = await metricsText();
    expect(text).toContain('# HELP http_requests_total Total HTTP requests handled by the service');
    expect(text).toContain('http_requests_total{method="POST",path="/auth/login",status="200"} 1');
    expect(text).toContain('http_requests_total{method="POST",path="/auth/login",status="401"} 1');
  });

  it('records histogram observations', async () => {
    recordHttpRequest({ method: 'GET', path: '/customer/dashboard', status: 200 }, 250);
    const text = await metricsText();
    expect(text).toContain('# HELP http_request_duration_seconds HTTP request duration in seconds');
    expect(text).toContain('http_request_duration_seconds_bucket{le="0.25",method="GET",path="/customer/dashboard",status="200"}');
  });

  it('counters increment across calls', async () => {
    recordHttpRequest({ method: 'GET', path: '/healthz', status: 200 }, 1);
    recordHttpRequest({ method: 'GET', path: '/healthz', status: 200 }, 1);
    const text = await metricsText();
    expect(text).toContain('http_requests_total{method="GET",path="/healthz",status="200"} 2');
  });

  it('includes node default metrics under the isp_ prefix', async () => {
    const text = await metricsText();
    expect(text).toContain('isp_process_cpu_seconds_total');
  });

  it('middleware writes content-type and the full metrics text', async () => {
    const headers: Record<string, string> = {};
    const body: string[] = [];
    const res = {
      setHeader: (k: string, v: string) => { headers[k] = v; },
      end: (b: string) => { body.push(b); },
    };
    await makeMetricsMiddleware()(undefined, res);
    expect(headers['Content-Type']).toBe(metricsContentType());
    expect(body.join('')).toContain('http_requests_total');
  });
});