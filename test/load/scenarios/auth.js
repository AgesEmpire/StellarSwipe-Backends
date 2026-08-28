import http from 'k6/http';
import { check, sleep, group } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = __ENV.TEST_EMAIL || 'loadtest@example.com';
const TEST_PASS = __ENV.TEST_PASS || 'LoadTest123!';

const headers = { 'Content-Type': 'application/json' };

/**
 * Auth flow load test — simulates login → use token → refresh cycle.
 */
export function auth() {
  let accessToken = '';
  let refreshToken = '';

  group('login', () => {
    const res = http.post(
      `${BASE_URL}/api/v1/auth/login`,
      JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS }),
      { headers },
    );

    check(res, {
      'login returns 200': (r) => r.status === 200,
      'login returns tokens': (r) => {
        try {
          const body = JSON.parse(r.body);
          accessToken = body.data?.accessToken || '';
          refreshToken = body.data?.refreshToken || '';
          return accessToken.length > 0;
        } catch {
          return false;
        }
      },
    });
  });

  sleep(1);

  group('authenticated request', () => {
    if (!accessToken) return;

    const res = http.get(`${BASE_URL}/api/v1/users/me`, {
      headers: { ...headers, Authorization: `Bearer ${accessToken}` },
    });

    check(res, {
      'profile returns 200 or 401': (r) => r.status === 200 || r.status === 401,
    });
  });

  sleep(0.5);

  group('token refresh', () => {
    if (!refreshToken) return;

    const res = http.post(
      `${BASE_URL}/api/v1/auth/refresh`,
      JSON.stringify({ refreshToken }),
      { headers },
    );

    check(res, {
      'refresh returns 200': (r) => r.status === 200,
    });
  });

  sleep(1);
}
