import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

/**
 * Health check load test — validates the health endpoint stays responsive
 * under sustained request load.
 */
export function health() {
  const res = http.get(`${BASE_URL}/api/v1/health/healthz`);

  check(res, {
    'health status is 200': (r) => r.status === 200,
    'health response time < 500ms': (r) => r.timings.duration < 500,
    'health body contains status': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'ok' || body.status === 'healthy';
      } catch {
        return false;
      }
    },
  });

  sleep(0.1);
}
