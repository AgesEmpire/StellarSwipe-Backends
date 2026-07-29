# Health Endpoint Failure Scenarios

This document describes the expected behavior of each health endpoint when individual dependencies fail.

## Endpoints

| Endpoint | Purpose | Checks |
|---|---|---|
| `GET /api/v1/health/healthz` | Liveness (is the process alive?) | None — returns 200 while the process runs |
| `GET /api/v1/health/ready` | Readiness (can traffic be served?) | DB, Redis, queue, Stellar, Soroban |
| `GET /api/v1/health/liveness` | Alias for `/healthz` | None |
| `GET /api/v1/health/readiness` | Alias for `/ready` (DB, Redis, queue only) | DB, Redis, queue |
| `GET /api/v1/health` | Full aggregate check | DB, Redis, Stellar, Soroban, queue |
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
| All healthy | 200 ✅ | 200 ✅ | 200 ✅ | Serve traffic |
