import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate = new Rate('errors');
const feedLatency = new Trend('feed_latency');
const tradeLatency = new Trend('trade_latency');
const signalLatency = new Trend('signal_latency');
const requestCount = new Counter('requests_total');

export const options = {
  scenarios: {
    // 1000 users browsing feed
    feed_browsers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 200 },
        { duration: '5m', target: 1000 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
      exec: 'browseFeed',
    },
    // 500 concurrent traders
    traders: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },
        { duration: '5m', target: 500 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
      exec: 'executeTrade',
    },
    // 100 signal submitters
    signal_submitters: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 20 },
        { duration: '5m', target: 100 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
      exec: 'submitSignal',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
    feed_latency: ['p(95)<2000'],
    trade_latency: ['p(95)<5000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export function browseFeed() {
  group('feed_browsing', () => {
    const res = http.get(`${BASE_URL}/api/signals/feed?limit=20`, {
      tags: { scenario: 'feed' },
    });
    requestCount.add(1);
    feedLatency.add(res.timings.duration);
    const ok = check(res, {
      'feed 200': (r) => r.status === 200,
      'feed fast': (r) => r.timings.duration < 2000,
    });
    errorRate.add(!ok);
    sleep(3);
  });
}

export function executeTrade() {
  group('trade_execution', () => {
    const res = http.post(
      `${BASE_URL}/api/trades/execute`,
      JSON.stringify({
        signalId: `signal-${Math.ceil(Math.random() * 100)}`,
        userId: `user-${__VU}`,
        amount: '500',
        asset: 'XLM',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { scenario: 'trade' },
      },
    );
    requestCount.add(1);
    tradeLatency.add(res.timings.duration);
    const ok = check(res, {
      'trade 201': (r) => r.status === 201,
      'trade fast': (r) => r.timings.duration < 5000,
    });
    errorRate.add(!ok);
    sleep(5);
  });
}

export function submitSignal() {
  group('signal_submission', () => {
    const res = http.post(
      `${BASE_URL}/api/signals`,
      JSON.stringify({
        asset: 'XLM',
        direction: Math.random() > 0.5 ? 'BUY' : 'SELL',
        targetPrice: (Math.random() * 10 + 0.1).toFixed(4),
        providerId: `provider-${__VU}`,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { scenario: 'signal' },
      },
    );
    requestCount.add(1);
    signalLatency.add(res.timings.duration);
    const ok = check(res, {
      'signal 201': (r) => r.status === 201,
    });
    errorRate.add(!ok);
    sleep(10);
  });
}

// Spike test scenario — run separately with: k6 run --env SCENARIO=spike
export function handleSummary(data) {
  return {
    'test/results/load-test-reports/summary.json': JSON.stringify(data, null, 2),
  };
}
