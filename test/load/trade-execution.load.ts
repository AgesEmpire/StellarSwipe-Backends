import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const tradeErrorRate = new Rate('trade_errors');
const tradeDuration = new Trend('trade_duration');

export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '5m', target: 500 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.01'],
    trade_errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Simulate a pool of signal IDs
const SIGNAL_IDS = Array.from({ length: 50 }, (_, i) => `signal-${i + 1}`);

export default function () {
  const signalId = SIGNAL_IDS[Math.floor(Math.random() * SIGNAL_IDS.length)];
  const userId = `user-${__VU}`; // virtual user ID

  const payload = JSON.stringify({
    signalId,
    userId,
    amount: (Math.random() * 1000 + 100).toFixed(2),
    asset: 'XLM',
  });

  const tradeRes = http.post(
    `${BASE_URL}/api/trades/execute`,
    payload,
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'trade_execute' },
    },
  );

  const ok = check(tradeRes, {
    'trade status 201': (r) => r.status === 201,
    'trade under 5s': (r) => r.timings.duration < 5000,
  });

  tradeErrorRate.add(!ok);
  tradeDuration.add(tradeRes.timings.duration);

  sleep(5);
}
