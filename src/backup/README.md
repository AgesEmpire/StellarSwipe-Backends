# Data Backup and Recovery System

## Overview
Automated PostgreSQL backup system with encryption, retention policies, and recovery procedures.

## Features
- **Automated Backups**: Daily (2 AM UTC), Weekly (Sunday 2 AM), Monthly (1st 2 AM)
- **Retention**: Daily 7 days, Weekly 4 weeks, Monthly 12 months
- **Security**: AES256 encryption via GPG
- **Process**: pg_dump → gzip → GPG encryption → verification

## Configuration
```bash
# .env
BACKUP_DIR=/var/backups/stellarswipe
BACKUP_GPG_PASSPHRASE=your-secure-passphrase
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=stellarswipe_db
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password
```

## Usage

### Manual Backup
```bash
cd src/backup/scripts
./backup.sh daily
```

### Manual Restore
```bash
./restore.sh /var/backups/stellarswipe/stellarswipe-db-daily-2026-02-25.sql.gz.gpg
```

### Programmatic
```typescript
await backupService.createBackup(BackupType.DAILY);
await backupService.restoreBackup('/path/to/backup.sql.gz.gpg');
const stats = await backupService.getBackupStats();
```

## Schedule
| Type | Schedule | Retention | Cron |
|------|----------|-----------|------|
| Daily | 2 AM UTC | 7 days | `0 2 * * *` |
| Weekly | 2 AM Sunday | 4 weeks | `0 2 * * 0` |
| Monthly | 2 AM 1st | 12 months | `0 2 1 * *` |

Cleanup: 3 AM UTC daily (`0 3 * * *`)

## Naming Convention
```
stellarswipe-db-{type}-{date}.sql.gz.gpg
```

## Edge Cases
- **High Load**: pg_dump creates consistent snapshots without locking
- **Storage Quota**: Automated cleanup enforces retention
- **Corrupted Backups**: Integrity verification after each backup

## Recovery Procedure
```bash
# 1. Stop application
pm2 stop stellarswipe

# 2. Restore
./restore.sh /path/to/backup.sql.gz.gpg

# 3. Verify
psql -U postgres -d stellarswipe_db -c "SELECT COUNT(*) FROM users;"

# 4. Restart
pm2 start stellarswipe
```

## Monitoring
Logs written to application logs. Failures logged as errors.

## Testing
```bash
npm test src/backup/backup.service.spec.ts
```
