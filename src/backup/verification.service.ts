import { Injectable, Logger } from '@nestjs/common';
import { stat, readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { existsSync } from 'fs';

export interface VerificationResult {
  passed: boolean;
  filePath: string;
  checks: {
    exists: boolean;
    minSize: boolean;
    notStale: boolean;
    checksumMatch: boolean | null; // null when no expected checksum provided
  };
  sizeBytes: number;
  ageMs: number;
  error?: string;
}

/** Minimum acceptable backup file size (1 KB). */
const MIN_SIZE_BYTES = 1_024;

/** Maximum age before a backup is considered stale (25 hours — covers daily cadence). */
const MAX_AGE_MS = 25 * 60 * 60 * 1_000;

/**
 * VerificationService — verifies periodic backup snapshots before and after restore.
 *
 * Closes the gap in BackupService.verifyBackup() which only checks file size > 0.
 * Adds:
 *   1. Existence check — file must be present on disk.
 *   2. Minimum size check — rejects suspiciously small files (truncated/empty).
 *   3. Staleness check — flags backups older than MAX_AGE_MS (25 h).
 *   4. Checksum verification — SHA-256 of the file must match an expected digest
 *      when one is provided (e.g. stored alongside the backup at creation time).
 *
 * Security: no credentials, passphrases, or secret values are read or logged.
 * Access-control semantics of the existing BackupService are unchanged.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  /**
   * Verify a backup snapshot file.
   *
   * @param filePath         Absolute path to the backup file.
   * @param expectedChecksum Optional SHA-256 hex digest to compare against.
   * @param maxAgeMs         Override the default staleness threshold.
   */
  async verify(
    filePath: string,
    expectedChecksum?: string,
    maxAgeMs = MAX_AGE_MS,
  ): Promise<VerificationResult> {
    const result: VerificationResult = {
      passed: false,
      filePath,
      checks: { exists: false, minSize: false, notStale: false, checksumMatch: null },
      sizeBytes: 0,
      ageMs: 0,
    };

    // 1. Existence
    result.checks.exists = existsSync(filePath);
    if (!result.checks.exists) {
      result.error = `Backup file not found: ${filePath}`;
      this.logger.warn(result.error);
      return result;
    }

    try {
      const stats = await stat(filePath);
      result.sizeBytes = stats.size;
      result.ageMs = Math.max(0, Date.now() - stats.mtimeMs);

      // 2. Minimum size
      result.checks.minSize = stats.size >= MIN_SIZE_BYTES;

      // 3. Staleness
      result.checks.notStale = maxAgeMs > 0 && result.ageMs <= maxAgeMs;

      // 4. Checksum (only when caller provides an expected digest)
      if (expectedChecksum) {
        const actual = await this.sha256(filePath);
        result.checks.checksumMatch = actual === expectedChecksum.toLowerCase();
        if (!result.checks.checksumMatch) {
          this.logger.warn(
            `Checksum mismatch for ${filePath}: expected ${expectedChecksum}, got ${actual}`,
          );
        }
      }

      result.passed =
        result.checks.exists &&
        result.checks.minSize &&
        result.checks.notStale &&
        (result.checks.checksumMatch === null || result.checks.checksumMatch === true);

      if (result.passed) {
        this.logger.log(
          `Backup verified OK: ${filePath} (${(result.sizeBytes / 1024).toFixed(1)} KB, age ${Math.round(result.ageMs / 1000)}s)`,
        );
      } else {
        this.logger.warn(
          `Backup verification FAILED: ${filePath} checks=${JSON.stringify(result.checks)}`,
        );
      }
    } catch (err: any) {
      result.error = err.message;
      this.logger.error(`Verification error for ${filePath}: ${err.message}`);
    }

    return result;
  }

  /** Compute SHA-256 hex digest of a file. */
  async sha256(filePath: string): Promise<string> {
    const buf = await readFile(filePath);
    return createHash('sha256').update(buf).digest('hex');
  }
}
