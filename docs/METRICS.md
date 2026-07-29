# Observability — Metrics & Error Monitoring

## Prometheus metrics endpoint

| Environment | URL |
|-------------|-----|
| Local       | `http://localhost:3000/api/v1/metrics` |
| Staging     | `https://api-staging.stellarswipe.io/api/v1/metrics` |
| Production  | `https://api.stellarswipe.io/api/v1/metrics` |

The endpoint requires the `METRICS_API_KEY` or a valid bearer token  
(enforced by `HealthMetricsAuthGuard`).

---

## Metric catalogue

### HTTP

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total HTTP requests |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Request latency (buckets: 5 ms → 5 s) |
| `http_requests_errors_total` | Counter | `method`, `route`, `status_code` | Requests with status ≥ 400 |

### Cache

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `cache_hits_total` | Counter | `layer` | Cache hits per layer (`redis`) |
| `cache_misses_total` | Counter | `layer` | Cache misses per layer (`redis`) |

### Business

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `trades_executed_total` | Counter | `side`, `status` | Trades executed |
| `signals_created_total` | Counter | `type` | Signals created |
| `active_users_gauge` | Gauge | – | Currently active users |
| `portfolio_value_total` | Gauge | – | Aggregate portfolio value |

### Database

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `db_query_duration_seconds` | Histogram | `operation`, `entity` | Query latency |
| `postgresql_connections_active` | Gauge | – | Active PG connections (polled every 15 s) |
| `db_pool_connections_total` | Gauge | – | Total pool connections |
| `db_pool_connections_active` | Gauge | – | Pool connections executing a query |
| `db_pool_connections_idle` | Gauge | – | Pool connections idle |
| `db_pool_connections_waiting` | Gauge | – | Pool connections waiting |
| `db_pool_utilization_ratio` | Gauge | – | Pool utilisation (0–1) |

### Health

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `service_health_status` | Gauge | `service` | 1 = up, 0 = down per dependency |

### Node.js (default metrics)

`nodejs_*` — heap, event-loop lag, GC pauses, active handles. Collected automatically by `prom-client`.

---

## Sample PromQL queries

```promql
# P95 request latency over the last 5 minutes
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route)
)

# Error rate (4xx/5xx) as a fraction of all requests
sum(rate(http_requests_errors_total[1m]))
  / sum(rate(http_requests_total[1m]))

# Cache hit-rate
sum(rate(cache_hits_total[5m]))
  / (sum(rate(cache_hits_total[5m])) + sum(rate(cache_misses_total[5m])))

# DB pool utilisation
db_pool_utilization_ratio

# Services that are currently down
service_health_status == 0
```

---

## Alerting guidance

### Recommended alert rules (AlertManager / Grafana)

```yaml
groups:
  - name: stellarswipe
    rules:
      - alert: HighErrorRate
        expr: >
          sum(rate(http_requests_errors_total[5m]))
            / sum(rate(http_requests_total[5m])) > 0.05
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Error rate > 5 % for 2 minutes"

      - alert: HighP95Latency
        expr: >
          histogram_quantile(0.95,
            sum(rate(http_request_duration_seconds_bucket[5m])) by (le)
          ) > 1
        for: 3m
        labels:
          severity: warning
        annotations:
          summary: "P95 latency > 1 s for 3 minutes"

      - alert: LowCacheHitRate
        expr: >
          sum(rate(cache_hits_total[5m]))
            / (sum(rate(cache_hits_total[5m])) + sum(rate(cache_misses_total[5m])))
            < 0.6
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Cache hit-rate < 60 % for 5 minutes"

      - alert: ServiceDown
        expr: service_health_status == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Dependency {{ $labels.service }} is down"

      - alert: DBPoolSaturation
        expr: db_pool_utilization_ratio > 0.85
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "DB connection pool > 85 % utilised"
```

### Grafana dashboard

Pre-built dashboards are in `infrastructure/monitoring/grafana/`.  
Import `infrastructure/monitoring/grafana/stellarswipe-overview.json` into your Grafana instance.

---

## Sentry error monitoring

| Setting | Variable | Default |
|---------|----------|---------|
| DSN | `SENTRY_DSN` | *(disabled when empty)* |
| Environment | `NODE_ENV` | `development` |
| Traces sample rate | `SENTRY_TRACES_SAMPLE_RATE` | `0.1` (10 %) |

### What is captured

- All unhandled exceptions via `GlobalExceptionFilter`
- `process.on('unhandledRejection')` and `process.on('uncaughtException')` in `main.ts`
- Request context: `path`, `method`, `userAgent` attached as a structured Sentry *request* context
- User identity (`userId`) and tenant (`tenantId`) set as Sentry user / tag when present

### Sensitive data scrubbing

`authorization` and `cookie` headers are removed from every Sentry event before transmission  
(see `beforeSend` in `SentryService.init()`).
