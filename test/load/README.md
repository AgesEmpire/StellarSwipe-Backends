# Load Testing

## Prerequisites

- [k6](https://k6.io/docs/getting-started/installation/) installed locally
- Backend running with `docker-compose up -d` (PostgreSQL + Redis)
- A test user created via `npm run seed`

## Running

```bash
# Full suite against local
npm run test:load

# Against staging
k6 run test/load/k6.config.js --env BASE_URL=https://staging-api.stellarswipe.com

# Single scenario
k6 run test/load/scenarios/health.js
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | Target API host |
| `TEST_EMAIL` | `loadtest@example.com` | Test user email |
| `TEST_PASS` | `LoadTest123!` | Test user password |

## Thresholds

| Metric | Target | Description |
|--------|--------|-------------|
| `http_req_failed` | < 5% | Overall error rate |
| `http_req_duration p95` | < 2s | 95th percentile latency |
| Health p99 | < 500ms | Health check response time |
| Auth p95 | < 3s | Auth flow response time |
| Trades p95 | < 5s | Trade operations response time |

## Refreshing Baseline

1. Start a clean local environment: `docker-compose down -v && docker-compose up -d`
2. Run migrations and seed: `npm run migration:run && npm run seed`
3. Execute: `npm run test:load`
4. Copy the summary output and update `baseline-results.json`
5. Commit the updated baseline
