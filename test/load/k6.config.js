/**
 * k6 Load Test Configuration — StellarSwipe Backend
 *
 * Usage:
 *   k6 run test/load/k6.config.js
 *   k6 run test/load/k6.config.js --env BASE_URL=http://staging.example.com
 *
 * Environment variables:
 *   BASE_URL   — target host (default: http://localhost:3000)
 *   TEST_EMAIL — test user email
 *   TEST_PASS  — test user password
 */

import { auth } from './scenarios/auth.js';
import { trades } from './scenarios/trades.js';
import { health } from './scenarios/health.js';

export const options = {
  scenarios: {
    health_check: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: 'health',
    },
    auth_flow: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 25 },
        { duration: '30s', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      exec: 'auth',
    },
    trade_operations: {
      executor: 'ramping-vus',
      startVUs: 0,
      startTime: '30s',
      stages: [
        { duration: '30s', target: 5 },
        { duration: '1m', target: 15 },
        { duration: '30s', target: 30 },
        { duration: '1m', target: 30 },
        { duration: '30s', target: 0 },
      ],
      exec: 'trades',
    },
  },

  thresholds: {
    // Global
    http_req_failed: ['rate<0.05'],           // <5% error rate
    http_req_duration: ['p(95)<2000'],         // 95th percentile <2s

    // Health check
    'http_req_duration{scenario:health_check}': ['p(99)<500'],  // <500ms

    // Auth flow
    'http_req_duration{scenario:auth_flow}': ['p(95)<3000'],    // <3s

    // Trade operations
    'http_req_duration{scenario:trade_operations}': ['p(95)<5000'], // <5s
  },
};

export { auth, trades, health };
