import http from 'k6/http';
import { check, sleep, group } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = __ENV.TEST_EMAIL || 'loadtest@example.com';
const TEST_PASS = __ENV.TEST_PASS || 'LoadTest123!';

const headers = { 'Content-Type': 'application/json' };

/**
 * Trades load test — simulates authenticated trade operations.
 */
export function trades() {
  // Login first
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
    { headers },
  );

  let accessToken = '';
  try {
    const body = JSON.parse(loginRes.body);
    accessToken = body.data?.accessToken || '';
  } catch {
    // skip if login fails
  }

  if (!accessToken) {
    sleep(2);
    return;
  }

  const authHeaders = {
    ...headers,
    Authorization: `Bearer ${accessToken}`,
  };

  group('list positions', () => {
    const res = http.get(`${BASE_URL}/api/v1/trades/positions`, {
      headers: authHeaders,
    });

    check(res, {
      'positions returns 200': (r) => r.status === 200,
      'positions response < 3s': (r) => r.timings.duration < 3000,
    });
  });

  sleep(0.5);

  group('list trade history', () => {
    const res = http.get(`${BASE_URL}/api/v1/trades?page=1&limit=20`, {
      headers: authHeaders,
    });

    check(res, {
      'trade history returns 200': (r) => r.status === 200,
      'trade history is array': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body.data);
        } catch {
          return false;
        }
      },
    });
  });

  sleep(0.5);

  group('get market data', () => {
    const res = http.get(`${BASE_URL}/api/v1/market-data/XLM`, {
      headers: authHeaders,
    });

    check(res, {
      'market data returns 200': (r) => r.status === 200,
      'market data response < 2s': (r) => r.timings.duration < 2000,
    });
  });

  sleep(1);
}
