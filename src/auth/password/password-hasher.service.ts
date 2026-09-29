import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

/** bcrypt cost used before the cost became configurable. */
export const DEFAULT_PASSWORD_HASH_ROUNDS = 10;
export const MIN_PASSWORD_HASH_ROUNDS = 10;
export const MAX_PASSWORD_HASH_ROUNDS = 15;

export type PasswordHashPersister = (
  previousHash: string,
  upgradedHash: string,
) => Promise<boolean>;

export interface PasswordVerificationResult {
  valid: boolean;
  /** True only when an outdated hash was rehashed and persisted. */
  upgraded: boolean;
}

/**
 * Hashes and verifies user passwords with a configurable bcrypt cost
 * (`PASSWORD_HASH_ROUNDS`).
 *
 * When the configured cost is raised, existing hashes are upgraded lazily:
 * after a password verifies, a hash whose cost is below the configured value
 * is rehashed and handed to a persister. Hashes already at (or above) the
 * configured cost are never rewritten, and a failed upgrade never fails the
 * authentication that triggered it — the next successful login retries.
 */
@Injectable()
export class PasswordHasherService {
  private readonly logger = new Logger(PasswordHasherService.name);
  readonly rounds: number;

  constructor(@Optional() configService?: ConfigService) {
    this.rounds = PasswordHasherService.resolveRounds(
      configService?.get<number | string>('PASSWORD_HASH_ROUNDS'),
    );
  }

  static resolveRounds(raw: number | string | undefined): number {
    if (raw === undefined || raw === null || raw === '') {
      return DEFAULT_PASSWORD_HASH_ROUNDS;
    }
    const parsed = Number(raw);
    if (
      !Number.isInteger(parsed) ||
      parsed < MIN_PASSWORD_HASH_ROUNDS ||
      parsed > MAX_PASSWORD_HASH_ROUNDS
    ) {
      throw new Error(
        `PASSWORD_HASH_ROUNDS must be an integer between ${MIN_PASSWORD_HASH_ROUNDS} and ${MAX_PASSWORD_HASH_ROUNDS}, got "${raw}"`,
      );
    }
    return parsed;
  }

  hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.rounds);
  }

  /**
   * True when `storedHash` was produced with a lower cost than configured.
   * Unrecognised hash formats are left alone rather than rewritten.
   */
  needsRehash(storedHash: string): boolean {
    try {
      return bcrypt.getRounds(storedHash) < this.rounds;
    } catch {
      return false;
    }
  }

  /**
   * Verifies `password` against `storedHash` and, on success, upgrades an
   * outdated hash through `persist`. The persister receives the hash that was
   * verified so it can refuse to overwrite a password changed concurrently.
   */
  async verifyAndUpgrade(
    password: string,
    storedHash: string | null | undefined,
    persist: PasswordHashPersister,
  ): Promise<PasswordVerificationResult> {
    if (!storedHash) {
      return { valid: false, upgraded: false };
    }

    let valid: boolean;
    try {
      valid = await bcrypt.compare(password, storedHash);
    } catch (error) {
      this.logger.warn(
        `Password verification failed: ${(error as Error).message}`,
      );
      return { valid: false, upgraded: false };
    }

    if (!valid || !this.needsRehash(storedHash)) {
      return { valid, upgraded: false };
    }

    try {
      const upgradedHash = await this.hash(password);
      const upgraded = await persist(storedHash, upgradedHash);
      if (!upgraded) {
        this.logger.debug(
          'Password hash upgrade skipped: stored hash changed concurrently',
        );
      }
      return { valid: true, upgraded };
    } catch (error) {
      this.logger.warn(
        `Password hash upgrade failed; will retry on next login: ${(error as Error).message}`,
      );
      return { valid: true, upgraded: false };
    }
  }
}
