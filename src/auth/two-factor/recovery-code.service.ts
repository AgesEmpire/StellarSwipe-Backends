import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  Inject,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { TwoFactor } from '../entities/two-factor.entity';
import { AuditService } from '../../../audit-log/audit.service';
import { AuditAction, AuditStatus } from '../../../audit-log/entities/audit-log.entity';

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 5;          // 10-char uppercase hex per code
const BCRYPT_ROUNDS = 12;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const REGEN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const REGEN_RATE_LIMIT_MAX = 3;

@Injectable()
export class RecoveryCodeService {
  private readonly logger = new Logger(RecoveryCodeService.name);

  constructor(
    @InjectRepository(TwoFactor)
    private readonly twoFactorRepo: Repository<TwoFactor>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly auditService: AuditService,
  ) {}

  // ─── Generation ──────────────────────────────────────────────────────────────

  /**
   * Generate RECOVERY_CODE_COUNT cryptographically secure codes, store them
   * hashed, and return the plaintext codes exactly once.
   * Called internally by TwoFactorService on enrollment confirmation.
   */
  async generate(userId: string): Promise<string[]> {
    const record = await this.getEnabledRecord(userId);

    const plaintext = this.generatePlaintext();
    record.backupCodes = await this.hashAll(plaintext);
    record.recoveryCodesGeneratedAt = new Date();
    record.recoveryCodesUsedCount = 0;
    await this.twoFactorRepo.save(record);

    await this.auditService.log({
      userId,
      action: AuditAction.RECOVERY_CODES_GENERATED,
      resource: 'two_factor_auth',
      resourceId: record.id,
      metadata: { codeCount: RECOVERY_CODE_COUNT },
      status: AuditStatus.SUCCESS,
    });

    this.logger.log(`Recovery codes generated for user ${userId}`);
    return plaintext;
  }

  // ─── Consumption ─────────────────────────────────────────────────────────────

  /**
   * Consume a single recovery code.
   * - Rate-limited to RATE_LIMIT_MAX_ATTEMPTS per window to block brute-force.
   * - Removes the matched hash (one-time use).
   * - Audits success and failure.
   * - Returns remaining code count so callers can warn the user.
   */
  async consume(
    userId: string,
    providedCode: string,
    ipAddress?: string,
  ): Promise<{ remainingCodes: number }> {
    await this.checkConsumeRateLimit(userId, ipAddress);

    const record = await this.twoFactorRepo.findOne({ where: { userId } });
    if (!record?.enabled) {
      throw new BadRequestException('2FA is not enabled for this account.');
    }

    const matchIndex = await this.findMatch(providedCode, record.backupCodes);

    if (matchIndex === -1) {
      await this.auditService.log({
        userId,
        action: AuditAction.RECOVERY_CODE_FAILED,
        resource: 'two_factor_auth',
        resourceId: record.id,
        metadata: { remainingCodes: record.backupCodes.length },
        ipAddress,
        status: AuditStatus.FAILURE,
      });
      throw new UnauthorizedException('Invalid recovery code.');
    }

    // Consume — splice out the matched hash
    record.backupCodes.splice(matchIndex, 1);
    record.recoveryCodesUsedCount = (record.recoveryCodesUsedCount ?? 0) + 1;
    await this.twoFactorRepo.save(record);

    await this.clearConsumeRateLimit(userId);

    await this.auditService.log({
      userId,
      action: AuditAction.RECOVERY_CODE_USED,
      resource: 'two_factor_auth',
      resourceId: record.id,
      metadata: {
        remainingCodes: record.backupCodes.length,
        totalUsed: record.recoveryCodesUsedCount,
      },
      ipAddress,
      status: AuditStatus.SUCCESS,
    });

    this.logger.log(
      `Recovery code consumed for user ${userId}. Remaining: ${record.backupCodes.length}`,
    );

    if (record.backupCodes.length === 0) {
      this.logger.warn(`User ${userId} has exhausted all recovery codes.`);
    }

    return { remainingCodes: record.backupCodes.length };
  }

  // ─── Regeneration ────────────────────────────────────────────────────────────

  /**
   * Invalidate all existing recovery codes and issue a fresh set.
   * Rate-limited to REGEN_RATE_LIMIT_MAX per hour.
   * Requires the caller to have already verified TOTP (enforced upstream).
   */
  async regenerate(userId: string, ipAddress?: string): Promise<string[]> {
    await this.checkRegenRateLimit(userId);

    const record = await this.getEnabledRecord(userId);

    const plaintext = this.generatePlaintext();
    record.backupCodes = await this.hashAll(plaintext);
    record.recoveryCodesGeneratedAt = new Date();
    record.recoveryCodesUsedCount = 0;
    record.lastSecurityChangeAt = new Date();
    await this.twoFactorRepo.save(record);

    await this.auditService.log({
      userId,
      action: AuditAction.RECOVERY_CODES_REGENERATED,
      resource: 'two_factor_auth',
      resourceId: record.id,
      metadata: { codeCount: RECOVERY_CODE_COUNT },
      ipAddress,
      status: AuditStatus.SUCCESS,
    });

    this.logger.log(`Recovery codes regenerated for user ${userId}. Previous codes invalidated.`);
    return plaintext;
  }

  // ─── Status ──────────────────────────────────────────────────────────────────

  /**
   * Return the number of remaining (unconsumed) recovery codes and when they
   * were last generated — without exposing any hashes.
   */
  async getStatus(userId: string): Promise<{
    remainingCodes: number;
    generatedAt: Date | null;
    totalUsed: number;
  }> {
    const record = await this.twoFactorRepo.findOne({ where: { userId } });
    if (!record?.enabled) {
      throw new BadRequestException('2FA is not enabled for this account.');
    }
    return {
      remainingCodes: record.backupCodes.length,
      generatedAt: record.recoveryCodesGeneratedAt ?? null,
      totalUsed: record.recoveryCodesUsedCount ?? 0,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private generatePlaintext(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      crypto.randomBytes(RECOVERY_CODE_BYTES).toString('hex').toUpperCase(),
    );
  }

  private async hashAll(codes: string[]): Promise<string[]> {
    return Promise.all(codes.map((c) => bcrypt.hash(c, BCRYPT_ROUNDS)));
  }

  private async findMatch(provided: string, hashes: string[]): Promise<number> {
    const results = await Promise.all(
      hashes.map((h) => bcrypt.compare(provided, h)),
    );
    return results.findIndex(Boolean);
  }

  private async getEnabledRecord(userId: string): Promise<TwoFactor> {
    const record = await this.twoFactorRepo.findOne({ where: { userId } });
    if (!record?.enabled) {
      throw new NotFoundException('2FA is not enabled for this account.');
    }
    return record;
  }

  // ─── Rate Limiting ───────────────────────────────────────────────────────────

  private async checkConsumeRateLimit(userId: string, ipAddress?: string): Promise<void> {
    const userKey = `recovery_consume:${userId}`;
    const ipKey = ipAddress ? `recovery_consume_ip:${ipAddress}` : null;

    const userAttempts = (await this.cache.get<number>(userKey)) ?? 0;
    if (userAttempts >= RATE_LIMIT_MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        `Too many recovery code attempts. Please wait before retrying.`,
      );
    }

    if (ipKey) {
      const ipAttempts = (await this.cache.get<number>(ipKey)) ?? 0;
      if (ipAttempts >= RATE_LIMIT_MAX_ATTEMPTS * 3) {
        throw new UnauthorizedException(
          `Too many recovery code attempts from this IP. Please wait before retrying.`,
        );
      }
      await this.cache.set(ipKey, ipAttempts + 1, RATE_LIMIT_WINDOW_MS);
    }

    await this.cache.set(userKey, userAttempts + 1, RATE_LIMIT_WINDOW_MS);
  }

  private async clearConsumeRateLimit(userId: string): Promise<void> {
    await this.cache.del(`recovery_consume:${userId}`);
  }

  private async checkRegenRateLimit(userId: string): Promise<void> {
    const key = `recovery_regen:${userId}`;
    const attempts = (await this.cache.get<number>(key)) ?? 0;
    if (attempts >= REGEN_RATE_LIMIT_MAX) {
      throw new UnauthorizedException(
        `Recovery codes can only be regenerated ${REGEN_RATE_LIMIT_MAX} times per hour.`,
      );
    }
    await this.cache.set(key, attempts + 1, REGEN_RATE_LIMIT_WINDOW_MS);
  }
}
