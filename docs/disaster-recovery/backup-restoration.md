# StellarSwipe — Backup & Restoration Guide

## Backup Architecture

```
PostgreSQL Primary (us-east-1)
  │
  ├── WAL archiving ──────────────────► S3: stellarswipe-dr-backups/wal/
  │     (real-time, 7-day retention)        (replicated → eu-west-1)
  │
  ├── pg_basebackup (hourly) ─────────► S3: stellarswipe-dr-backups/incremental/
  │                                         (replicated → eu-west-1)
  │
  ├── pg_dump (daily 02:00 UTC) ──────► S3: stellarswipe-dr-backups/full/
  │     AES-256 GPG encrypted               (replicated → eu-west-1)
  │     30-day retention
  │
  └── EBS Snapshot (weekly) ──────────► AWS Backup vault (90-day retention)

Redis Primary (us-east-1)
  └── Sentinel replication ──────────► Redis replica (eu-west-1)
```

All backups are:
- **Compressed** with gzip before encryption
- **Encrypted** with AES-256 GPG
- **Checksummed** (SHA-256 stored alongside the backup record)
- **Verified** daily in a disposable test database
- **Replicated** cross-region automatically by S3 CRR (Cross-Region Replication)

---

## Retrieving Credentials

The GPG passphrase and database credentials are stored in AWS Secrets Manager:

```bash
# GPG passphrase
GPG_PASS=$(aws secretsmanager get-secret-value \
    --secret-id /stellarswipe/prod/backup-gpg-passphrase \
    --query SecretString --output text)

# Database superuser password
DB_PASS=$(aws secretsmanager get-secret-value \
    --secret-id /stellarswipe/prod/database-password \
    --query SecretString --output text)
```

---

## Full Backup Restoration

### 1. Locate the backup

```bash
# List available full backups (most recent last)
aws s3 ls s3://stellarswipe-dr-backups/full/ | sort

# Or from a specific date
aws s3 ls s3://stellarswipe-dr-backups/full/ | grep "2026-03-26"
```

### 2. Download

```bash
aws s3 cp s3://stellarswipe-dr-backups/full/<filename>.sql.gz.gpg /tmp/restore/
```

### 3. Decrypt

```bash
gpg --batch --yes \
    --passphrase "$GPG_PASS" \
    --decrypt \
    -o /tmp/restore/backup.sql.gz \
    /tmp/restore/<filename>.sql.gz.gpg
```

### 4. Decompress

```bash
gunzip /tmp/restore/backup.sql.gz
```

### 5. Restore

```bash
# Create the target database if it does not exist
PGPASSWORD="$DB_PASS" psql -h <db-host> -U postgres \
    -c "CREATE DATABASE stellarswipe;"

# Restore
PGPASSWORD="$DB_PASS" psql -h <db-host> -U postgres \
    -d stellarswipe \
    -f /tmp/restore/backup.sql
```

### 6. Verify

```sql
-- Connect to the restored DB and run sanity checks
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM trades;
SELECT COUNT(*) FROM signals;
SELECT MAX(created_at) AS latest_trade FROM trades;
```

### 7. Clean up temp files

```bash
rm -rf /tmp/restore/
```

---

## Point-in-Time Recovery (PITR)

PITR allows restoring to any second within the WAL retention window (7 days).

### When to use PITR

- Data corruption or accidental deletion within the last 7 days
- Auditing — restore a copy to inspect data at a specific timestamp

### Steps

1. **Identify the target time** — the moment just before the incident:
   ```sql
   -- Check audit log for the last clean state
   SELECT MAX(created_at) FROM audit_log
   WHERE event_type NOT IN ('data_anomaly', 'corruption');
   ```

2. **Restore the base backup** (full backup immediately before target time):
   Follow "Full Backup Restoration" steps above, restoring into a temporary database `stellarswipe_pitr`.

3. **Configure WAL replay**:
   ```ini
   # postgresql.conf (on the restored instance)
   restore_command = 'aws s3 cp s3://stellarswipe-dr-backups/wal/%f %p'
   recovery_target_time = '2026-03-26 12:00:00+00'
   recovery_target_action = 'promote'
   ```

4. **Start PostgreSQL** — it will replay WAL segments up to the target time automatically.

5. **Verify and promote**:
   ```sql
   SELECT pg_wal_replay_resume();
   ```

6. **Promote the PITR database to primary** if it is the authoritative source.

---

## Incremental Backup Restoration

Incremental backups (`pg_basebackup`) produce a binary copy of the data directory
and are used when a full SQL restore would take too long.

```bash
# Download
aws s3 cp s3://stellarswipe-dr-backups/incremental/<filename>.tar.gz.gpg /tmp/

# Decrypt + decompress
gpg --batch --passphrase "$GPG_PASS" --decrypt \
    -o /tmp/backup.tar.gz /tmp/<filename>.tar.gz.gpg
tar -xzf /tmp/backup.tar.gz -C /var/lib/postgresql/data/

# Start PostgreSQL
pg_ctl start -D /var/lib/postgresql/data/
```

---

## Redis Restoration

Redis data is replicated synchronously to eu-west-1 via Redis Sentinel.
In the event of total Redis loss:

```bash
# Restore from the latest RDB snapshot in S3
aws s3 cp s3://stellarswipe-dr-backups/redis/dump.rdb /var/lib/redis/dump.rdb

# Restart Redis
systemctl restart redis
```

After restart, the application will automatically reconnect and repopulate ephemeral cache keys.

---

## Backup Verification

The `BackupVerificationJob` runs daily at 04:00 UTC and:
1. Restores the previous night's full backup to `stellarswipe_verify_<timestamp>`
2. Runs integrity queries against `users`, `signals`, and `trades`
3. Drops the test database
4. Alerts the team if any check fails

To run manually:
```bash
curl -X POST https://api.stellarswipe.com/api/v1/admin/dr/verify-backup \
    -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected response:
```json
{
  "passed": true,
  "backupId": "2026-03-26T02-00-00-000Z"
}
```

---

## S3 Bucket Policy (Cross-Region Replication)

```json
{
  "Rules": [{
    "Status": "Enabled",
    "Destination": {
      "Bucket": "arn:aws:s3:::stellarswipe-dr-backups-eu-west-1",
      "StorageClass": "STANDARD_IA",
      "ReplicationTime": { "Status": "Enabled", "Time": { "Minutes": 15 } },
      "Metrics": { "Status": "Enabled", "EventThreshold": { "Minutes": 15 } }
    },
    "DeleteMarkerReplication": { "Status": "Disabled" }
  }]
}
```

---

## RTO / RPO Compliance Table

| Scenario | Backup tier used | Expected restore time | RPO |
|---|---|---|---|
| Full DB loss — last hour data | Incremental + WAL | ~10 min | < 5 min |
| Full DB loss — yesterday data | Full backup | ~20 min | < 24 h |
| Data corruption 2 h ago | PITR from full + WAL | ~15 min | < 5 min |
| Redis total loss | RDB snapshot | ~2 min | ~5 min |
| EBS volume corruption | EBS snapshot | ~5 min | ~7 days |
