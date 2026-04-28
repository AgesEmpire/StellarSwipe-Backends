import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('feed_errors');
const feedDuration = new Trend('feed_duration');

export const options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '5m', target: 1000 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
    feed_errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Browse feed
  const feedRes = http.get(`${BASE_URL}/api/signals/feed?limit=20`, {
    tags: { name: 'feed' },
  });

  const ok = check(feedRes, {
    'feed status 200': (r) => r.status === 200,
    'feed under 2s': (r) => r.timings.duration < 2000,
    'feed has data': (r) => r.body.length > 0,
  });

  errorRate.add(!ok);
  feedDuration.add(feedRes.timings.duration);

  sleep(3);

  // Browse next page
  const page2 = http.get(`${BASE_URL}/api/signals/feed?limit=20&offset=20`, {
    tags: { name: 'feed_page2' },
  });

  check(page2, {
    'page2 status 200': (r) => r.status === 200,
  });

  sleep(2);
}
