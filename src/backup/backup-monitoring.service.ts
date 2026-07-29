import { Injectable, Logger } from '@nestjs/common';
import { Counter, Gauge, Registry } from 'prom-client';

export interface BackupEvent {
  type: 'daily' | 'weekly' | 'monthly';
  success: boolean;
  durationMs: number;
  sizeBytes?: number;
  offsite?: boolean;
  error?: string;
}

/**
 * BackupMonitoringService — emits Prometheus metrics for backup jobs.
 * Tracks success/failure counters, last backup timestamp, and duration.
 */
@Injectable()
export class BackupMonitoringService {
  private readonly logger = new Logger(BackupMonitoringService.name);

  private readonly registry: Registry;
  readonly backupSuccessTotal: Counter;
  readonly backupFailureTotal: Counter;
  readonly backupDurationSeconds: Gauge;
  readonly backupSizeBytes: Gauge;
  readonly lastBackupTimestamp: Gauge;
  readonly offsiteUploadSuccessTotal: Counter;
  readonly offsiteUploadFailureTotal: Counter;

  constructor() {
    this.registry = new Registry();

    this.backupSuccessTotal = new Counter({
      name: 'backup_success_total',
      help: 'Total successful backup jobs',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.backupFailureTotal = new Counter({
      name: 'backup_failure_total',
      help: 'Total failed backup jobs',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.backupDurationSeconds = new Gauge({
      name: 'backup_duration_seconds',
      help: 'Duration of the last backup job in seconds',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.backupSizeBytes = new Gauge({
      name: 'backup_size_bytes',
      help: 'Size of the last backup file in bytes',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.lastBackupTimestamp = new Gauge({
      name: 'backup_last_success_timestamp_seconds',
      help: 'Unix timestamp of the last successful backup',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.offsiteUploadSuccessTotal = new Counter({
      name: 'backup_offsite_upload_success_total',
      help: 'Total successful S3 offsite uploads',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.offsiteUploadFailureTotal = new Counter({
      name: 'backup_offsite_upload_failure_total',
      help: 'Total failed S3 offsite uploads',
      labelNames: ['type'],
      registers: [this.registry],
    });
  }

  record(event: BackupEvent): void {
    const { type, success, durationMs, sizeBytes, offsite, error } = event;

    if (success) {
      this.backupSuccessTotal.inc({ type });
      this.lastBackupTimestamp.set({ type }, Math.floor(Date.now() / 1000));
      this.logger.log(`Backup success [${type}] duration=${durationMs}ms size=${sizeBytes ?? 'unknown'}`);
    } else {
      this.backupFailureTotal.inc({ type });
      this.logger.error(`Backup failure [${type}]: ${error ?? 'unknown error'}`);
    }

    this.backupDurationSeconds.set({ type }, durationMs / 1000);

    if (sizeBytes !== undefined) {
      this.backupSizeBytes.set({ type }, sizeBytes);
    }

    if (offsite !== undefined) {
      if (offsite) {
        this.offsiteUploadSuccessTotal.inc({ type });
      } else {
        this.offsiteUploadFailureTotal.inc({ type });
      }
    }
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
