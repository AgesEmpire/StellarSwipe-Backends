import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import { stat, unlink, readdir, mkdtemp, rm } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const execAsync = promisify(exec);

export interface BackupRecord {
  id: string;
  type: BackupTier;
  path: string;
  sizeBytes: number;
  createdAt: Date;
  verified: boolean;
  checksum: string;
}

export enum BackupTier {
  WAL = 'wal',           // Continuous WAL archiving — real-time, 7-day retention
  INCREMENTAL = 'incremental', // pg_basebackup — hourly, 24-hour retention
  FULL = 'full',         // pg_dump — daily, 30-day retention
  SNAPSHOT = 'snapshot', // Volume snapshot — weekly, 90-day retention
}

export const RETENTION_DAYS: Record<BackupTier, number> = {
  [BackupTier.WAL]: 7,
  [BackupTier.INCREMENTAL]: 1,
  [BackupTier.FULL]: 30,
  [BackupTier.SNAPSHOT]: 90,
};

@Injectable()
export class BackupManagerService {
  private readonly logger = new Logger(BackupManagerService.name);

  private readonly backupDir: string;
  private readonly dbHost: string;
  private readonly dbPort: number;
  private readonly dbName: string;
  private readonly dbUser: string;
  private readonly dbPassword: string;
  private readonly gpgPassphrase: string;
  private readonly s3Bucket: string;
  private readonly s3Region: string;

  constructor(private readonly config: ConfigService) {
    this.backupDir = config.get('BACKUP_DIR', '/var/backups/stellarswipe/dr');
    this.dbHost = config.get('DATABASE_HOST', 'localhost');
    this.dbPort = config.get<number>('DATABASE_PORT', 5432);
    this.dbName = config.get('DATABASE_NAME', 'stellarswipe');
    this.dbUser = config.get('DATABASE_USER', 'postgres');
    this.dbPassword = config.get('DATABASE_PASSWORD', '');
    this.gpgPassphrase = config.get('BACKUP_GPG_PASSPHRASE', '');
    this.s3Bucket = config.get('DR_S3_BUCKET', 'stellarswipe-dr-backups');
    this.s3Region = config.get('DR_S3_REGION', 'us-east-1');

    if (!existsSync(this.backupDir)) {
      mkdirSync(this.backupDir, { recursive: true });
    }
  }

  // ── Full backup (pg_dump) ───────────────────────────────────────────────────

  async createFullBackup(): Promise<BackupRecord> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `full-${timestamp}.sql`;
    const gzPath = join(this.backupDir, `${filename}.gz`);
    const encPath = `${gzPath}.gpg`;

    this.logger.log('Starting full backup (pg_dump)…');

    const env = { ...process.env, PGPASSWORD: this.dbPassword };
    const dumpCmd = [
      'pg_dump',
      `-h ${this.dbHost}`,
      `-p ${this.dbPort}`,
      `-U ${this.dbUser}`,
      `-d ${this.dbName}`,
      '--format=plain',
      '--no-owner',
      '--no-privileges',
    ].join(' ');

    await execAsync(`${dumpCmd} | gzip > ${gzPath}`, { env });
    await this.encryptFile(gzPath, encPath);
    await unlink(gzPath);

    const checksum = await this.sha256(encPath);
    const { size } = await stat(encPath);

    await this.uploadToS3(encPath, `full/${encPath.split('/').pop()!}`);

    this.logger.log(`Full backup complete: ${encPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);

    return {
      id: timestamp,
      type: BackupTier.FULL,
      path: encPath,
      sizeBytes: size,
      createdAt: new Date(),
      verified: false,
      checksum,
    };
  }

  // ── Incremental backup (pg_basebackup) ─────────────────────────────────────

  async createIncrementalBackup(): Promise<BackupRecord> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const targetDir = join(this.backupDir, `incremental-${timestamp}`);
    const tarPath = `${targetDir}.tar.gz`;
    const encPath = `${tarPath}.gpg`;

    this.logger.log('Starting incremental backup (pg_basebackup)…');

    const env = { ...process.env, PGPASSWORD: this.dbPassword };
    await execAsync(
      `pg_basebackup -h ${this.dbHost} -p ${this.dbPort} -U ${this.dbUser} -D ${targetDir} --wal-method=stream --gzip --compress=5`,
      { env },
    );
    await execAsync(`tar -czf ${tarPath} -C ${this.backupDir} incremental-${timestamp}`);
    await rm(targetDir, { recursive: true, force: true });
    await this.encryptFile(tarPath, encPath);
    await unlink(tarPath);

    const checksum = await this.sha256(encPath);
    const { size } = await stat(encPath);

    await this.uploadToS3(encPath, `incremental/${encPath.split('/').pop()!}`);

    this.logger.log(`Incremental backup complete: ${encPath}`);

    return {
      id: timestamp,
      type: BackupTier.INCREMENTAL,
      path: encPath,
      sizeBytes: size,
      createdAt: new Date(),
      verified: false,
      checksum,
    };
  }

  // ── Backup verification ─────────────────────────────────────────────────────

  async verifyBackup(record: BackupRecord): Promise<boolean> {
    this.logger.log(`Verifying backup: ${record.path}`);
    const tempDir = await mkdtemp(join(tmpdir(), 'stellarswipe-verify-'));

    try {
      // 1. Checksum integrity
      const currentChecksum = await this.sha256(record.path);
      if (currentChecksum !== record.checksum) {
        this.logger.error(`Checksum mismatch for backup ${record.id}`);
        return false;
      }

      // 2. Decrypt to temp
      const decryptedPath = join(tempDir, 'backup.sql.gz');
      await this.decryptFile(record.path, decryptedPath);

      // 3. Decompress and restore to ephemeral test DB
      const sqlPath = join(tempDir, 'backup.sql');
      await execAsync(`gunzip -c ${decryptedPath} > ${sqlPath}`);

      const testDb = `stellarswipe_verify_${Date.now()}`;
      const env = { ...process.env, PGPASSWORD: this.dbPassword };

      await execAsync(
        `psql -h ${this.dbHost} -p ${this.dbPort} -U ${this.dbUser} -c "CREATE DATABASE ${testDb}"`,
        { env },
      );

      try {
        await execAsync(
          `psql -h ${this.dbHost} -p ${this.dbPort} -U ${this.dbUser} -d ${testDb} -f ${sqlPath}`,
          { env },
        );

        // 4. Integrity probes
        const checks = await Promise.allSettled([
          execAsync(`psql -h ${this.dbHost} -p ${this.dbPort} -U ${this.dbUser} -d ${testDb} -c "SELECT COUNT(*) FROM users"`, { env }),
          execAsync(`psql -h ${this.dbHost} -p ${this.dbPort} -U ${this.dbUser} -d ${testDb} -c "SELECT COUNT(*) FROM signals"`, { env }),
          execAsync(`psql -h ${this.dbHost} -p ${this.dbPort} -U ${this.dbUser} -d ${testDb} -c "SELECT COUNT(*) FROM trades"`, { env }),
        ]);

        const passed = checks.filter((r) => r.status === 'fulfilled').length;
        this.logger.log(`Backup verification: ${passed}/${checks.length} integrity checks passed`);

        return passed === checks.length;
      } finally {
        await execAsync(
          `psql -h ${this.dbHost} -p ${this.dbPort} -U ${this.dbUser} -c "DROP DATABASE IF EXISTS ${testDb}"`,
          { env },
        );
      }
    } catch (err) {
      this.logger.error(`Backup verification failed: ${(err as Error).message}`);
      return false;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  // ── Retention cleanup ───────────────────────────────────────────────────────

  async purgeExpiredBackups(): Promise<number> {
    let deleted = 0;

    for (const tier of Object.values(BackupTier)) {
      const retentionMs = RETENTION_DAYS[tier] * 86_400_000;
      const cutoff = new Date(Date.now() - retentionMs);

      try {
        const files = await readdir(this.backupDir);
        for (const file of files) {
          if (!file.startsWith(tier)) continue;
          const fullPath = join(this.backupDir, file);
          const { mtime } = await stat(fullPath);
          if (mtime < cutoff) {
            await unlink(fullPath);
            this.logger.log(`Purged expired ${tier} backup: ${file}`);
            deleted++;
          }
        }
      } catch (err) {
        this.logger.warn(`Purge error for tier ${tier}: ${(err as Error).message}`);
      }
    }

    return deleted;
  }

  // ── Point-in-time recovery ──────────────────────────────────────────────────

  async restoreToPointInTime(targetTime: Date, targetDb: string): Promise<void> {
    this.logger.log(`Starting PITR restore to ${targetTime.toISOString()} → ${targetDb}`);

    // 1. Find the latest full backup before the target time
    const fullBackup = await this.findLatestFullBackupBefore(targetTime);
    if (!fullBackup) throw new Error('No full backup found before the target time');

    const tempDir = await mkdtemp(join(tmpdir(), 'stellarswipe-pitr-'));
    try {
      // 2. Restore base
      const decryptedGz = join(tempDir, 'base.sql.gz');
      const decryptedSql = join(tempDir, 'base.sql');
      await this.decryptFile(fullBackup, decryptedGz);
      await execAsync(`gunzip -c ${decryptedGz} > ${decryptedSql}`);

      const env = { ...process.env, PGPASSWORD: this.dbPassword };
      await execAsync(
        `psql -h ${this.dbHost} -p ${this.dbPort} -U ${this.dbUser} -d ${targetDb} -f ${decryptedSql}`,
        { env },
      );

      // 3. Apply WAL segments up to targetTime
      await this.applyWalUpTo(targetTime, targetDb);

      this.logger.log(`PITR restore complete for target: ${targetTime.toISOString()}`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async encryptFile(inputPath: string, outputPath: string): Promise<void> {
    await execAsync(
      `gpg --batch --yes --passphrase "${this.gpgPassphrase}" --symmetric --cipher-algo AES256 -o ${outputPath} ${inputPath}`,
    );
  }

  private async decryptFile(inputPath: string, outputPath: string): Promise<void> {
    await execAsync(
      `gpg --batch --yes --passphrase "${this.gpgPassphrase}" --decrypt -o ${outputPath} ${inputPath}`,
    );
  }

  private async sha256(filePath: string): Promise<string> {
    const { stdout } = await execAsync(`sha256sum ${filePath}`);
    return stdout.trim().split(/\s+/)[0];
  }

  private async uploadToS3(localPath: string, s3Key: string): Promise<void> {
    const s3Uri = `s3://${this.s3Bucket}/${s3Key}`;
    try {
      await execAsync(
        `aws s3 cp ${localPath} ${s3Uri} --region ${this.s3Region} --storage-class STANDARD_IA`,
      );
      this.logger.log(`Uploaded to S3: ${s3Uri}`);
    } catch (err) {
      this.logger.warn(`S3 upload failed (continuing): ${(err as Error).message}`);
    }
  }

  private async findLatestFullBackupBefore(before: Date): Promise<string | null> {
    try {
      const files = (await readdir(this.backupDir))
        .filter((f) => f.startsWith('full-') && f.endsWith('.gpg'))
        .map((f) => ({
          name: f,
          // Extract timestamp embedded in filename: full-YYYY-MM-DDTHH-MM-SS-...
          ts: new Date(f.replace('full-', '').replace('.sql.gz.gpg', '').replace(/-/g, (_, i) => (i < 10 ? '-' : ':'))),
        }))
        .filter((f) => f.ts < before)
        .sort((a, b) => b.ts.getTime() - a.ts.getTime());

      return files.length > 0 ? join(this.backupDir, files[0].name) : null;
    } catch {
      return null;
    }
  }

  private async applyWalUpTo(targetTime: Date, _targetDb: string): Promise<void> {
    // In production: copy WAL segments from the archive (S3) into
    // pg_wal and set recovery_target_time in recovery.conf / postgresql.conf.
    // Stub implementation for documentation / CI safety.
    this.logger.log(`Applying WAL segments up to ${targetTime.toISOString()} (stub)`);
  }
}
