# StellarSwipe — Disaster Recovery: Recovery Procedures

## Overview

This document is the authoritative reference for all recovery procedures.
It is owned by the Platform Engineering team and must be reviewed after every DR drill and every production incident.

**Last tested**: see [DR drill log](failover-runbook.md#drill-history)
**Owner**: Platform Engineering (`#platform-oncall` on Slack)
**Escalation**: CTO → VP Engineering → On-call Lead

---

## Recovery Time Objectives (RTO)

| Service tier | Target RTO | Scope |
|---|---|---|
| Critical | **< 15 minutes** | API endpoints, database, authentication |
| Important | **< 1 hour** | Analytics, reporting, background jobs |
| Non-critical | **< 4 hours** | Historical data, archived logs |

## Recovery Point Objectives (RPO)

| Data type | Target RPO | Mechanism |
|---|---|---|
| Transactional data | **< 5 minutes** | PostgreSQL streaming replication |
| User data | **< 1 hour** | Hourly incremental backups |
| Analytics data | **< 24 hours** | Daily full backups |

---

## Backup Tiers

| Tier | Type | Frequency | Retention | Storage |
|---|---|---|---|---|
| WAL | Continuous WAL archiving | Real-time | 7 days | S3 `us-east-1` + `eu-west-1` |
| Incremental | `pg_basebackup` | Hourly | 24 hours | S3 `us-east-1` + `eu-west-1` |
| Full | `pg_dump` (compressed + encrypted) | Daily 02:00 UTC | 30 days | S3 (cross-region replication) |
| Snapshot | EBS / volume snapshot | Weekly Sunday 03:00 UTC | 90 days | AWS Backup vault |

Backups are encrypted with AES-256 GPG before upload.
The passphrase is stored in AWS Secrets Manager (`/stellarswipe/prod/backup-gpg-passphrase`).

---

## Scenario 1 — Database Complete Loss

### Decision tree

```
Is the primary RDS instance responding?
  ├─ YES → Check for data corruption (see Scenario 3)
  └─ NO  → Is the Multi-AZ standby healthy?
              ├─ YES → Trigger RDS failover (< 60 s, automatic)
              └─ NO  → Restore from backup (see steps below)
```

### Steps

1. **Page on-call DBA** via PagerDuty — incident priority P1.

2. **Confirm failure scope**:
   ```bash
   aws rds describe-db-instances --db-instance-identifier stellarswipe-prod
   # Check DBInstanceStatus, SecondaryAvailabilityZone
   ```

3. **Attempt automatic Multi-AZ failover**:
   ```bash
   aws rds reboot-db-instance --db-instance-identifier stellarswipe-prod --force-failover
   ```
   Wait up to 2 minutes. If the instance becomes `available`, proceed to step 8.

4. **If failover fails — restore from latest backup**:
   ```bash
   # Find the latest encrypted backup
   aws s3 ls s3://stellarswipe-dr-backups/full/ --recursive | sort | tail -1

   # Download
   aws s3 cp s3://stellarswipe-dr-backups/full/<filename>.sql.gz.gpg /tmp/

   # Decrypt
   gpg --batch --passphrase "$(aws secretsmanager get-secret-value \
       --secret-id /stellarswipe/prod/backup-gpg-passphrase \
       --query SecretString --output text)" \
       --decrypt -o /tmp/backup.sql.gz /tmp/<filename>.sql.gz.gpg

   # Decompress
   gunzip /tmp/backup.sql.gz

   # Restore to new RDS instance
   psql -h <new-rds-endpoint> -U postgres -d stellarswipe -f /tmp/backup.sql
   ```

5. **Apply WAL segments for PITR** (to minimise data loss):
   ```bash
   # Set recovery target in postgresql.conf:
   # recovery_target_time = '2026-03-26 12:00:00'
   # restore_command = 'aws s3 cp s3://stellarswipe-dr-backups/wal/%f %p'
   ```

6. **Update application config** to point to new DB endpoint:
   ```bash
   kubectl set env deployment/stellarswipe-api \
       DATABASE_HOST=<new-endpoint> -n stellarswipe
   ```

7. **Verify data integrity**:
   ```sql
   SELECT COUNT(*) FROM users;
   SELECT COUNT(*) FROM trades WHERE created_at > NOW() - INTERVAL '1 hour';
   SELECT MAX(created_at) FROM trades;
   ```

8. **Resume normal operations** and **open post-mortem** within 24 hours.

---

## Scenario 2 — Redis Complete Loss

### Steps

1. **Check ElastiCache cluster**:
   ```bash
   aws elasticache describe-replication-groups \
       --replication-group-id stellarswipe-redis
   ```

2. **Attempt automatic failover** (if Sentinel / cluster mode is active):
   ```bash
   aws elasticache test-failover \
       --replication-group-id stellarswipe-redis \
       --node-group-id 0001
   ```

3. **Application behaviour during outage**:
   - Cache reads fall back to PostgreSQL automatically.
   - Rate limiting is bypassed (allow-through mode).
   - Session tokens stored in DB remain valid.
   - Monitor `database_query_rate` — expect a spike.

4. **Create replacement cluster** if failover fails:
   ```bash
   terraform apply -target=aws_elasticache_replication_group.main \
       -var="node_type=cache.r6g.large"
   ```

5. **Update application config**:
   ```bash
   kubectl set env deployment/stellarswipe-api \
       REDIS_HOST=<new-cluster-endpoint> -n stellarswipe
   ```

6. **Warm cache** after recovery:
   ```bash
   curl -X POST https://api.stellarswipe.com/api/v1/admin/cache/warm \
       -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

---

## Scenario 3 — Data Corruption

1. **Stop all write traffic immediately**:
   - Set feature flag `MAINTENANCE_MODE=true` via Config Service.
   - This causes all POST/PUT/PATCH/DELETE endpoints to return `503`.

2. **Identify the corruption window**:
   ```sql
   -- Find the earliest affected record
   SELECT MIN(created_at) FROM audit_log WHERE event_type = 'data_anomaly';
   ```

3. **Restore to the point before corruption** using PITR:
   ```bash
   # Target time should be 5 minutes before the corruption started
   # See: src/disaster-recovery/services/backup-manager.service.ts#restoreToPointInTime
   ```

4. **Compare restored vs current** data using `pg_dump --schema-only` diff.

5. **Re-apply valid transactions** from the audit log.

6. **Lift maintenance mode** after validation.

---

## Scenario 4 — Full Region Failure (us-east-1 → eu-west-1)

See [Failover Runbook](failover-runbook.md) for the step-by-step automated process.

**Manual trigger** (if the automatic health-monitor failover did not fire):
```bash
curl -X POST https://api.stellarswipe.com/api/v1/admin/dr/failover \
    -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Post-Recovery Checklist

- [ ] Confirm all health checks pass: `GET /api/v1/health`
- [ ] Verify critical user flows: login, signal feed, trade execution
- [ ] Check Stellar transaction finality for in-flight trades
- [ ] Confirm backup jobs resume on schedule
- [ ] Validate Prometheus metrics are flowing to Grafana
- [ ] Update incident Slack thread with recovery time
- [ ] Schedule post-mortem within 48 hours
- [ ] Update this document with lessons learned
