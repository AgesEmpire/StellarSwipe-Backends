import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import { unlink, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { BackupMonitoringService } from './backup-monitoring.service';

const execAsync = promisify(exec);

export enum BackupType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupDir: string;
  private readonly dbHost: string;
  private readonly dbPort: number;
  private readonly dbName: string;
  private readonly dbUser: string;
  private readonly dbPassword: string;
  private readonly gpgPassphrase: string;
  private readonly s3Bucket: string;
  private readonly s3Region: string;
  private readonly s3Enabled: boolean;

  constructor(
    private configService: ConfigService,
    private readonly monitoring: BackupMonitoringService,
  ) {
    this.backupDir = this.configService.get('BACKUP_DIR', '/var/backups/stellarswipe');
    this.dbHost = this.configService.get('DATABASE_HOST', 'localhost');
    this.dbPort = this.configService.get('DATABASE_PORT', 5432);
    this.dbName = this.configService.get('DATABASE_NAME', 'stellarswipe_db');
    this.dbUser = this.configService.get('DATABASE_USER', 'postgres');
    this.dbPassword = this.configService.get('DATABASE_PASSWORD', '');
    this.gpgPassphrase = this.configService.get('BACKUP_GPG_PASSPHRASE', 'change-me');
    this.s3Bucket = this.configService.get('BACKUP_S3_BUCKET', '');
    this.s3Region = this.configService.get('BACKUP_S3_REGION', 'us-east-1');
    this.s3Enabled = !!this.s3Bucket;
    this.ensureBackupDir();
  }

  private ensureBackupDir(): void {
    if (!existsSync(this.backupDir)) {
      mkdirSync(this.backupDir, { recursive: true });
    }
  }

  async createBackup(type: BackupType): Promise<string> {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `stellarswipe-db-${type}-${timestamp}.sql`;
    const gzFilename = `${filename}.gz`;
    const encryptedFilename = `${gzFilename}.gpg`;
    const filePath = join(this.backupDir, filename);
    const gzPath = join(this.backupDir, gzFilename);
    const encryptedPath = join(this.backupDir, encryptedFilename);
    const start = Date.now();

    try {
      this.logger.log(`Starting ${type} backup...`);
      await this.dumpDatabase(filePath);
      await this.compressFile(filePath, gzPath);
      await this.encryptFile(gzPath, encryptedPath);
      await this.verifyBackup(encryptedPath);
      await unlink(filePath);
      await unlink(gzPath);

      const { size } = await stat(encryptedPath);
      const durationMs = Date.now() - start;

      // Offsite S3 upload
      let offsiteOk: boolean | undefined;
      if (this.s3Enabled) {
        offsiteOk = await this.uploadToS3(encryptedPath, `${type}/${encryptedFilename}`);
      }

      this.monitoring.record({ type, success: true, durationMs, sizeBytes: size, offsite: offsiteOk });
      this.logger.log(`Backup completed: ${encryptedFilename}`);
      return encryptedPath;
    } catch (error) {
      this.monitoring.record({ type, success: false, durationMs: Date.now() - start, error: error.message });
      this.logger.error(`Backup failed: ${error.message}`);
      throw error;
    }
  }

  private async dumpDatabase(outputPath: string): Promise<void> {
    const cmd = `PGPASSWORD="${this.dbPassword}" pg_dump -h ${this.dbHost} -p ${this.dbPort} -U ${this.dbUser} -d ${this.dbName} -F p -f ${outputPath}`;
    try {
      await execAsync(cmd);
      this.logger.log('Database dump completed');
    } catch (error) {
      throw new Error(`Database dump failed: ${error.message}`);
    }
  }

  private async compressFile(inputPath: string, outputPath: string): Promise<void> {
    try {
      await execAsync(`gzip -c ${inputPath} > ${outputPath}`);
      this.logger.log('Compression completed');
    } catch (error) {
      throw new Error(`Compression failed: ${error.message}`);
    }
  }

  private async encryptFile(inputPath: string, outputPath: string): Promise<void> {
    try {
      await execAsync(`gpg --batch --yes --passphrase "${this.gpgPassphrase}" --symmetric --cipher-algo AES256 -o ${outputPath} ${inputPath}`);
      this.logger.log('Encryption completed');
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  private async verifyBackup(filePath: string): Promise<void> {
    try {
      const stats = await stat(filePath);
      if (stats.size === 0) throw new Error('Backup file is empty');
      this.logger.log(`Backup verified: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    } catch (error) {
      throw new Error(`Backup verification failed: ${error.message}`);
    }
  }

  async cleanupOldBackups(type: BackupType, retentionDays: number): Promise<void> {
    const pattern = `stellarswipe-db-${type}-*.sql.gz.gpg`;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    try {
      const { stdout } = await execAsync(`find ${this.backupDir} -name "${pattern}" -type f`);
      const files = stdout.trim().split('\n').filter(Boolean);

      for (const file of files) {
        const stats = await stat(file);
        if (stats.mtime < cutoffDate) {
          await unlink(file);
          this.logger.log(`Deleted old backup: ${file}`);
        }
      }
    } catch (error) {
      this.logger.error(`Cleanup failed: ${error.message}`);
    }
  }

  async restoreBackup(backupPath: string): Promise<void> {
    const tempDir = join(this.backupDir, 'restore');
    const decryptedPath = join(tempDir, 'backup.sql.gz');
    const decompressedPath = join(tempDir, 'backup.sql');

    try {
      this.logger.log('Starting restore process...');
      if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

      await execAsync(`gpg --batch --yes --passphrase "${this.gpgPassphrase}" --decrypt -o ${decryptedPath} ${backupPath}`);
      await execAsync(`gunzip -c ${decryptedPath} > ${decompressedPath}`);
      await execAsync(`PGPASSWORD="${this.dbPassword}" psql -h ${this.dbHost} -p ${this.dbPort} -U ${this.dbUser} -d ${this.dbName} -f ${decompressedPath}`);

      await unlink(decryptedPath);
      await unlink(decompressedPath);
      this.logger.log('Restore completed successfully');
    } catch (error) {
      this.logger.error(`Restore failed: ${error.message}`);
      throw error;
    }
  }

  private async uploadToS3(localPath: string, s3Key: string): Promise<boolean> {
    const s3Uri = `s3://${this.s3Bucket}/${s3Key}`;
    try {
      await execAsync(
        `aws s3 cp ${localPath} ${s3Uri} --region ${this.s3Region} --storage-class STANDARD_IA`,
      );
      this.logger.log(`Offsite upload OK: ${s3Uri}`);
      return true;
    } catch (err) {
      this.logger.error(`Offsite upload failed: ${(err as Error).message}`);
      return false;
    }
  }

  async getBackupStats(): Promise<any> {
    try {
      const { stdout } = await execAsync(`find ${this.backupDir} -name "*.gpg" -type f`);
      const files = stdout.trim().split('\n').filter(Boolean);

      let totalSize = 0;
      const backups = await Promise.all(files.map(async (file) => {
        const stats = await stat(file);
        totalSize += stats.size;
        return { filename: file.split('/').pop(), size: stats.size, created: stats.mtime };
      }));

      return {
        totalBackups: backups.length,
        totalSize: totalSize,
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
        backups: backups.sort((a, b) => b.created.getTime() - a.created.getTime()),
      };
    } catch (error) {
      this.logger.error(`Failed to get backup stats: ${error.message}`);
      return { totalBackups: 0, totalSize: 0, backups: [] };
    }
  }
}
