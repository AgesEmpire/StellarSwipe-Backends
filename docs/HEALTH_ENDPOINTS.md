# Health Endpoint Failure Scenarios

This document describes the expected behavior of each health endpoint when individual dependencies fail.

## Endpoints

| Endpoint | Purpose | Checks |
|---|---|---|
| `GET /api/v1/health/healthz` | Liveness (is the process alive?) | None — returns 200 while the process runs |
| `GET /api/v1/health/ready` | Readiness (can traffic be served?) | DB, Redis, queue, Stellar, Soroban |
| `GET /api/v1/health/liveness` | Alias for `/healthz` | None |
| `GET /api/v1/health/readiness` | Alias for `/ready` (DB, Redis, queue only) | DB, Redis, queue |
| `GET /api/v1/health` | Full aggregate check | DB, Redis, Stellar, Soroban, queue, message broker |
| `GET /api/v1/health/broker` | Message broker (Kafka) check | Message broker only |
| `GET /api/v1/health/summary` | Detailed status report | All services with latency |

---

## Failure Scenarios

### 1. PostgreSQL database unavailable

**Trigger:** DB host unreachable, connection pool exhausted, or `SELECT 1` timeout.

**Affected endpoints:** `/healthz` ✅ (still 200), `/ready` ❌ (503), `/readiness` ❌ (503)

**Response (503):**
```json
{
  "status": "error",
  "info": {},
  "error": {
    "database": {
      "status": "down",
      "type": "postgres",
      "connected": false,
      "error": "Connection refused"
    }
  },
  "details": { "database": { "status": "down" } }
}
```

**Kubernetes behavior:**
- `livenessProbe` → `/healthz` → **no restart** (process is alive)
- `readinessProbe` → `/ready` → **pod removed from Service** (no new traffic routed)
- Pod stays running; once DB recovers and `/ready` returns 200 three consecutive times, traffic is restored.

**Recovery:** Restore DB connectivity. Kubernetes readiness re-checks every 5s and restores the pod automatically.

---

### 2. Redis cache unavailable

**Trigger:** Redis host unreachable, authentication failure, or `PING` timeout.

**Affected endpoints:** `/healthz` ✅ (still 200), `/ready` ❌ (503), `/readiness` ❌ (503)

**Response (503):**
```json
{
  "status": "error",
  "error": {
    "cache": {
      "status": "down",
      "error": "connect ECONNREFUSED 127.0.0.1:6379"
    }
  }
}
```

**Kubernetes behavior:** Same as DB — pod removed from rotation, no restart. Bull queues (backed by Redis) will also fail — the queue health check will independently reflect this.

**Recovery:** Restore Redis. Bull reconnects automatically; readiness probe resumes passing.

---

### 3. Worker queue (Bull) unhealthy

**Trigger:** Redis disconnection (Bull uses Redis), queue paused, or inability to read job counts.

**Affected endpoints:** `/healthz` ✅ (still 200), `/ready` ❌ (503), `/readiness` ❌ (503)

**Response (503):**
```json
{
  "status": "error",
  "error": {
    "queue": {
      "status": "down",
      "error": "Redis connection lost"
    }
  }
}
```

**Note:** Because Bull is backed by Redis, a Redis outage typically causes both `cache` and `queue` checks to fail simultaneously.

**Recovery:** Restore Redis connectivity. Bull automatically reconnects and resumes processing.

---

### 3b. Message broker (Kafka) unhealthy

**Trigger:** The broker fails to deliver a round-trip probe message (`KafkaHealthIndicator`, `src/health/indicators/kafka.health.ts`).

**Affected endpoints:** `/healthz` ✅ (still 200), `/broker` ❌ (503), aggregate `/health` ❌ (503)

**Response (503):**
```json
{
  "status": "error",
  "error": {
    "broker": {
      "status": "disconnected",
      "error": "Broker did not deliver the probe message"
    }
  }
}
```

**Note:** `KafkaService` (`src/streaming/kafka/kafka.service.ts`) is not yet wired into request-handling code paths, so the broker is intentionally excluded from `/ready` and `/readiness` — it does not currently gate traffic. It is included in the full `/health` check and `/health/summary` so operators still get visibility into it.

**Recovery:** Restart the broker connection / underlying pod. Once a real Kafka client replaces the in-process stub, update this indicator to verify actual broker connectivity (e.g. `admin.describeCluster()`).

---

### 4. Stellar Horizon unreachable

**Trigger:** `https://horizon-testnet.stellar.org` returns an error or times out.

**Affected endpoints:** `/healthz` ✅, `/readiness` ✅ (DB+Redis+queue only), `/ready` ❌ (503)

**Response on `/ready` (503):**
```json
{
  "status": "error",
  "error": {
    "stellar": {
      "status": "down",
      "network": "testnet",
      "error": "Network request failed"
    }
  }
}
```

**Kubernetes behavior:** `readinessProbe` uses `/ready` — pod removed from rotation. This is intentional: the app cannot process blockchain transactions when Horizon is unreachable.

**Mitigation:** If transient network issues are causing unnecessary pod removals, consider changing `readinessProbe` to use `/readiness` (which excludes blockchain checks) and route blockchain-dependent features to return 503 at the application layer instead.

---

### 5. Soroban RPC unreachable

**Trigger:** `https://soroban-testnet.stellar.org` is down or the `getHealth` RPC call fails.

**Affected endpoints:** `/healthz` ✅, `/readiness` ✅, `/ready` ❌ (503)

**Response on `/ready` (503):**
```json
{
  "status": "error",
  "error": {
    "soroban": {
      "status": "down",
      "sorobanRpcUrl": "https://soroban-testnet.stellar.org:443",
      "error": "connect ETIMEDOUT"
    }
  }
}
```

**Kubernetes behavior:** Same as Stellar Horizon — pod removed from rotation.

---

### 6. Multiple dependencies down simultaneously

If database and Redis both fail, the response body reports all failures; the HTTP status is still 503:

```json
{
  "status": "error",
  "info": {},
  "error": {
    "database": { "status": "down", "error": "Connection refused" },
    "cache":    { "status": "down", "error": "ECONNREFUSED :6379" },
    "queue":    { "status": "down", "error": "Redis connection lost" }
  }
}
```

---

### 7. Application startup — dependencies not yet ready

During the startup window (up to 90s governed by `startupProbe`), the app retries DB+Redis up to 5 times with 3s delays (see `onApplicationBootstrap`).

- If dependencies recover within the retry window → startup succeeds normally.
- If dependencies are still down after 5 retries → `process.exit(1)` is called, Kubernetes restarts the pod and tries again.

---

## Summary Table

| Failure | `/healthz` | `/readiness` | `/ready` | Kubernetes action |
|---|---|---|---|---|
| DB down | 200 ✅ | 503 ❌ | 503 ❌ | Remove from rotation |
| Redis down | 200 ✅ | 503 ❌ | 503 ❌ | Remove from rotation |
| Queue down | 200 ✅ | 503 ❌ | 503 ❌ | Remove from rotation |
| Stellar down | 200 ✅ | 200 ✅ | 503 ❌ | Remove from rotation |
| Soroban down | 200 ✅ | 200 ✅ | 503 ❌ | Remove from rotation |
| Process hung | 503 ❌ | — | — | Restart pod |
| Broker down | 200 ✅ | 200 ✅ | 200 ✅ | No action — not on the request path |
| All healthy | 200 ✅ | 200 ✅ | 200 ✅ | Serve traffic |

---

## How These Endpoints Are Consumed

**Kubernetes (`k8s/base/deployment.yaml`):**
- `startupProbe` and `livenessProbe` both point at `/api/v1/health/live` — process-alive only, so a dependency outage never triggers a pod restart.
- `readinessProbe` points at `/api/v1/health/ready` — DB, Redis, queue, and blockchain services must all be healthy for the pod to receive traffic.

**Monitoring:**
- `infrastructure/monitoring/alerts.yml` defines one Prometheus alert per dependency (`DatabaseDown`, `RedisDown`, `StellarHorizonDown`, `SorobanRpcDown`, `MessageBrokerDown`, ...), each firing when its `/api/v1/health/<dependency>` route returns 5xx for a sustained window — this is what pages on-call.
- Every indicator also reports to the `service_health_status` Prometheus gauge (`recordHealthCheck` in `src/monitoring/metrics/custom-metrics.ts`), scraped independently of the HTTP routes — available for a Grafana panel alongside the request-rate/latency panels already in `infrastructure/monitoring/grafana/dashboards/system-health.json`.
- `GET /api/v1/health/summary` is the human-readable endpoint operators hit during an incident — it returns latency and structured error detail per dependency in one call, avoiding the need to poll each `/health/<dependency>` route individually.
