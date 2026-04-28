# StellarSwipe Chaos Scenarios & Incident Playbooks

This document describes the four chaos scenarios implemented under `test/chaos/`,
the expected system behaviour during each failure, and the runbooks to follow
when a similar incident occurs in production.

---

## Overview

| Scenario | Test file | Target component | Injection method |
|---|---|---|---|
| Database failure | `database-failure.chaos.ts` | PostgreSQL | Patch `DataSource.query` |
| Redis / cache failure | `redis-failure.chaos.ts` | Redis / cache store | Patch `CacheStore.get/set` |
| Stellar network latency / partition | `stellar-network-latency.chaos.ts` | Horizon API (axios) | Axios interceptors |
| High load spike | `high-load.chaos.ts` | Service layer | `concurrentRequests` helper |

Run all chaos tests:

```bash
npx jest --config jest.chaos.config.js
```

Run a single scenario:

```bash
npx jest --config jest.chaos.config.js test/chaos/database-failure.chaos.ts
```

---

## Resilience targets

| Metric | Target |
|---|---|
| Availability during DB failure (cache serves reads) | ≥ 90 % |
| Availability during Redis failure (DB serves reads) | ≥ 95 % |
| Availability during Stellar partition (queued writes) | 100 % for reads, 202 queued for writes |
| p99 feed latency under 200-user spike | < 500 ms |
| MTTR after any single-component failure | < 30 s |
| Error rate during high-load spike | 0 % unhandled errors (429 is acceptable) |

---

## Scenario 1 — Database Failure

### What is tested

1. Normal operation is confirmed.
2. `DataSource.query` is patched to throw `Connection terminated unexpectedly`.
3. The signal feed is verified to be served from the in-memory / Redis cache.
4. Trade creation is verified to return `503 Service Unavailable`.
5. The patch is removed to simulate reconnection.
6. The system verifies it resumes normal operation within the recovery window.

### Expected degraded behaviour

- **GET /signals** → `200 OK` (cache hit).
- **POST /trades** → `503 Service Unavailable` with message `"Trades are temporarily unavailable. Please try again later."`.
- No unhandled exceptions, no process crash.

### Recovery indicators

- `DataSource.query` resolves without throwing.
- `waitUntilReady` check passes within 30 s.
- Queued trades can be re-submitted.

### Production runbook — DB outage

1. **Alert fires**: `PostgresConnectionPool` health check fails.
2. **Confirm**: `psql -h <host> -U <user> -c "SELECT 1"` should hang or error.
3. **Immediate mitigation**: Feature flags — set `READ_ONLY_MODE=true` in config to prevent failed write attempts from cascading.
4. **Page on-call DBA** with PagerDuty incident.
5. **Check RDS / Postgres logs** for OOM, disk full, or parameter group change.
6. **Restart / failover**: Trigger RDS failover if using Multi-AZ; or restore from latest automated snapshot.
7. **Validate recovery**: Watch `postgresql_up` metric in Grafana; confirm app reconnects within 1 minute of DB availability.
8. **Drain queue**: Once DB is up, trigger the trade-queue flush job.
9. **Post-mortem**: Document root cause within 48 h.

---

## Scenario 2 — Redis / Cache Failure

### What is tested

1. Cache is seeded with feed data.
2. `CacheStore.get/set` are patched to throw.
3. Feed endpoint falls back to DB.
4. Rate limiting degrades gracefully (allow-through, no crash).
5. Cold-start scenario: cache returns `undefined` on every read (simulates empty Redis after restart).
6. Cascading failure: both cache and DB unavailable → `503`.
7. Recovery restores cache-first serving.

### Expected degraded behaviour

- **GET /signals** → `200 OK` (served from DB; slightly higher latency).
- **Rate limiting** → disabled / allow-through (logged as warning).
- **Cache + DB down** → `503 Service Unavailable`.

### Recovery indicators

- `CacheStore.get` resolves without throwing.
- `RedisHealthIndicator` reports healthy.
- Cache warms up automatically on first DB read.

### Production runbook — Redis outage

1. **Alert fires**: `RedisConnectionRefused` in logs.
2. **Confirm**: `redis-cli -h <host> PING` returns `COULD NOT CONNECT`.
3. **Immediate mitigation**: Application tolerates Redis loss by design — monitor error rate and DB CPU.
4. **Check ElastiCache / Redis node**: console for replication lag, OOM evictions, or failover in progress.
5. **Force failover** (if cluster mode): `aws elasticache test-failover --replication-group-id <id> --node-group-id 0001`.
6. **Verify reconnect**: Application uses `ioredis` retry strategy; should reconnect within 30 s automatically.
7. **Warm cache**: Trigger cache-warm cron job or restart background worker that pre-fills popular keys.
8. **Re-enable rate limiting**: Remove any allow-through overrides after Redis is healthy.

---

## Scenario 3 — Stellar Network Latency / Partition

### What is tested

1. Normal Horizon requests succeed within 3 s timeout.
2. **High latency**: 5 s delay → requests exceed timeout → `504 Gateway Timeout`.
3. Trades during latency → queued with `202 Accepted`.
4. **Full partition**: all Horizon requests fail with `ECONNREFUSED` → `503`.
5. Trade queue accumulates entries during partition.
6. Recovery: Horizon reachable → queue is flushed, all trades processed.

### Expected degraded behaviour

- **GET /account/:address** under timeout → `504` with human-readable message.
- **POST /transactions** during partition → `202 Accepted` (queued for retry).
- No raw error stack traces exposed to callers.

### Recovery indicators

- Horizon `GET /` returns `200`.
- Trade-queue flush job processes all pending entries without failures.

### Production runbook — Stellar / Horizon outage

1. **Alert fires**: `HorizonRequestTimeout` or `HorizonConnectionRefused` in logs.
2. **Check Stellar status**: `https://status.stellar.org` for network-wide incidents.
3. **Switch Horizon endpoint** (if custom node is down): update `STELLAR_HORIZON_URL` to `https://horizon.stellar.org` (mainnet) or `https://horizon-testnet.stellar.org` (testnet).
4. **Trade queue**: Confirm Bull queue is accumulating jobs and not dropping them. Check `QUEUE_DEPTH` metric.
5. **User communication**: Push notification / email to users with active positions. Message: *"We are experiencing connectivity issues with the Stellar network. Your trades have been queued and will execute automatically once connectivity is restored."*
6. **Monitor recovery**: Watch `stellar_horizon_response_time_ms` metric. Once p95 < 2 s, queue flush starts automatically.
7. **Manual flush** (if auto-flush fails): `curl -X POST /admin/queues/trade-queue/resume`.
8. **Verify no double-spend**: Confirm all queued transaction hashes are unique and not duplicated on-chain.

---

## Scenario 4 — High Load Spike

### What is tested

1. 10 concurrent users — all requests succeed.
2. 200 concurrent requests from 1 user — rate limiting engages at threshold.
3. 500 requests spread across 50 users — no unhandled errors.
4. p99 latency stays below 500 ms for feed requests.
5. Write-path has stricter rate limits (10 trades/window vs 100 reads/window).
6. System stabilises after spike (rate-limit window reset).
7. 1000-user burst — rate-limit store size is bounded.

### Expected degraded behaviour

- **Above rate-limit threshold** → `429 Too Many Requests`.
- **Never** → `500 Internal Server Error`.
- `p99` latency stays below 500 ms.

### Recovery indicators

- Rate-limit counters reset at window boundary.
- `429` rate drops back to 0 after spike subsides.
- CPU / memory returns to baseline within 60 s.

### Production runbook — Traffic spike / DDoS

1. **Alert fires**: `HTTP 429 rate > 5%` or `CPU > 80%` or `response_time_p99 > 2s`.
2. **Identify source**: Check access logs for IP distribution. Single IP or ASN → likely abuse. Organic traffic → scale out.
3. **Organic spike (product event / viral)**:
   a. Trigger horizontal pod autoscaler: `kubectl scale deployment api --replicas=<N>`.
   b. Increase Redis connection pool: update `REDIS_MAX_CONNECTIONS`.
   c. Enable read-replica routing for GET endpoints.
4. **Abuse / DDoS**:
   a. Enable Cloudflare "Under Attack" mode.
   b. Add offending IPs to WAF block list.
   c. Tighten rate limits temporarily: `RATE_LIMIT_GLOBAL=50`.
5. **Database bottleneck**: Check slow-query log. Add read replica if write/read ratio is skewed.
6. **Post-spike**: Scale down replicas after traffic normalises. Document spike cause.

---

## Metrics reference

| Metric | Description | Tool |
|---|---|---|
| MTTR | Mean Time To Recovery (failure onset → first healthy response) | `ResilienceMetrics.mttrMs` |
| Availability % | `successful / total * 100` during failure window | `ResilienceMetrics.availabilityPct` |
| Error rate % | `failed / total * 100` | `ResilienceMetrics.errorRatePct` |
| p50 / p95 / p99 latency | Response time percentiles | `ResilienceMetrics.p50Ms` etc. |
| Failure window | Duration from failure start to recovery | `ResilienceMetrics.failureWindowMs` |

---

## Edge cases covered

| Edge case | Covered in |
|---|---|
| Cascading failure (DB + Redis both down) | `redis-failure.chaos.ts` — Step 5 |
| Split-brain / stale cache served after DB recovery | `database-failure.chaos.ts` — Step 3 |
| Transaction queued during network partition | `stellar-network-latency.chaos.ts` — Step 3 |
| Rate-limit store unbounded growth | `high-load.chaos.ts` — Step 6 |
| Slow DB (latency, not hard failure) | `database-failure.chaos.ts` — Step 4 |
| Redis cold start (empty cache after restart) | `redis-failure.chaos.ts` — Step 3 |
| Internal errors not exposed to callers | `stellar-network-latency.chaos.ts` — Step 3 |
| Mixed read/write data races under load | `high-load.chaos.ts` — Step 7 |
