# StellarSwipe — Failover Runbook

## Purpose

Step-by-step procedures for executing a controlled failover from the primary region
(`us-east-1`) to the secondary region (`eu-west-1`), and for failing back once the
primary is healthy.

**Automated system**: `src/disaster-recovery/services/failover-coordinator.service.ts`
**Health monitor**: `src/disaster-recovery/services/health-monitor.service.ts`
**Trigger threshold**: >2 component failures across 3 consecutive health checks (every 2 min)

---

## Automatic vs Manual Failover

| Mode | Trigger | Who authorises |
|---|---|---|
| Automatic | HealthMonitorService detects threshold breach | System (no human required) |
| Manual — drill | Admin API: `POST /admin/dr/drill` | On-call engineer |
| Manual — real | Admin API: `POST /admin/dr/failover` | On-call lead + CTO approval |

---

## Pre-Failover Checklist

Run before any manual failover:

- [ ] Confirm primary is actually down (`pg_isready -h <primary-host>` fails)
- [ ] Confirm secondary is reachable (`pg_isready -h <secondary-host>` succeeds)
- [ ] Check replication lag: `SELECT now() - pg_last_xact_replay_timestamp() AS lag`
  - Must be < 5 minutes to meet RPO target
- [ ] Notify team in `#incidents` Slack channel
- [ ] Open PagerDuty incident (P1 if customers are impacted)
- [ ] Ensure at least two engineers are on the call

---

## Failover Procedure (Automated)

The `FailoverCoordinatorService.executeFailover()` performs these steps:

### Step 1 — Detect primary failure
```
pg_isready -h <primary-host> -p 5432 -t 5
```
If the primary responds, failover is aborted (not needed).

### Step 2 — Verify secondary readiness
```
pg_isready -h <secondary-host> -p 5432 -t 5
```
If secondary is not ready, failover throws and the team is alerted.

### Step 3 — Promote secondary to primary
```bash
# PostgreSQL 12+ — trigger file approach (handled by failover coordinator)
touch /tmp/postgresql.trigger.5432
# OR
pg_ctl promote -D /var/lib/postgresql/data
```
Expected duration: **< 30 seconds**

### Step 4 — Update DNS (Route 53)
```json
{
  "Action": "UPSERT",
  "ResourceRecordSet": {
    "Name": "api.stellarswipe.com",
    "Type": "A",
    "TTL": 60,
    "ResourceRecords": [{ "Value": "<secondary-ip>" }]
  }
}
```
DNS TTL is set to 60 s. Full propagation: **< 2 minutes**

### Step 5 — Verify new primary
Poll `pg_isready` on the new primary until it accepts connections (max 150 s).

### Step 6 — Notify team
Slack webhook posts a summary including duration, new IP, and event log.

### Total expected RTO: **< 15 minutes**

---

## Failback Procedure

Once the primary region is restored:

1. **Restore primary DB** from the latest backup (see [backup-restoration.md](backup-restoration.md)).

2. **Re-establish replication** from current primary (eu-west-1) → old primary (us-east-1):
   ```sql
   -- On old primary, set it up as a standby of the current primary
   -- postgresql.conf:
   -- primary_conninfo = 'host=<eu-west-1-host> user=replicator password=...'
   -- recovery_target_timeline = 'latest'
   ```

3. **Wait for replication lag to reach zero**:
   ```sql
   SELECT now() - pg_last_xact_replay_timestamp() AS lag;
   -- Should be < 5 s before failback
   ```

4. **Execute failback via admin API**:
   ```bash
   curl -X POST https://api.stellarswipe.com/api/v1/admin/dr/failback \
       -H "Authorization: Bearer $ADMIN_TOKEN"
   ```
   Or programmatically: `FailoverCoordinatorService.executeFailback(false)`

5. **Verify traffic flows to us-east-1**:
   ```bash
   dig api.stellarswipe.com +short
   # Should resolve to us-east-1 IP
   ```

6. **Confirm eu-west-1 resumes standby role**.

---

## DR Drill Schedule

| Quarter | Date | Type | Pass/Fail | RTO achieved | Notes |
|---|---|---|---|---|---|
| Q1 2026 | First Monday of March 02:00 UTC | Simulated failover | — | — | Scheduled |
| Q2 2026 | First Monday of June 02:00 UTC | Simulated failover | — | — | Scheduled |
| Q3 2026 | First Monday of September 02:00 UTC | Full failover | — | — | Scheduled |
| Q4 2026 | First Monday of December 02:00 UTC | Simulated failover | — | — | Scheduled |

### DR Drill Checklist

#### Pre-Drill (48 h before)
- [ ] Schedule maintenance window (off-peak: 02:00–06:00 UTC)
- [ ] Notify team in `#platform-eng` Slack
- [ ] Verify latest backup was successful
- [ ] Document current system state (replica lag, API p99, error rate)
- [ ] Confirm secondary is in sync (lag < 5 min)

#### During Drill
- [ ] Execute: `POST /api/v1/admin/dr/drill`
- [ ] Monitor failover event log in response body
- [ ] Confirm simulated DNS update logged
- [ ] Verify all health checks still pass (drill mode does not affect traffic)
- [ ] Record actual RTO from response `totalDurationMs`

#### Post-Drill
- [ ] Execute: `POST /api/v1/admin/dr/failback` (drill mode)
- [ ] Update drill history table above
- [ ] File lessons-learned document if RTO > 15 min
- [ ] Address any gaps before next drill

---

## Runbook — Split-Brain Prevention

A split-brain occurs when both primary and secondary think they are writable.

**Prevention**:
- PostgreSQL uses a `pg_ctl promote` / trigger file — the old primary becomes read-only automatically on promotion of the replica.
- A `STONITH` ("shoot the other node in the head") fence via AWS EC2 instance stop is executed before promoting the secondary.

**Detection**:
- Monitor `pg_is_in_recovery()` on both nodes. Both returning `false` signals split-brain.
- Alert: `CRITICAL: split-brain detected — both nodes in read-write mode`

**Resolution**:
1. Immediately stop writes to the old primary: `ALTER SYSTEM SET default_transaction_read_only = on; SELECT pg_reload_conf();`
2. Determine which node has more recent data: `SELECT pg_current_wal_lsn();`
3. The node with the higher LSN is the authoritative primary.
4. Resync the stale node from the authoritative primary.

---

## Key Contacts

| Role | Contact | Escalation |
|---|---|---|
| On-call engineer | PagerDuty rotation | `#incidents` |
| Platform Engineering | `#platform-eng` | On-call lead |
| Database Admin | DBA on-call | Platform Engineering lead |
| CTO | Direct message | For production failover authorisation |
