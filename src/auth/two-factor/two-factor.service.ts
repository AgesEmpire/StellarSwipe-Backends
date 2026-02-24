import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { TwoFactor } from './entities/two-factor.entity';
import { Enable2faDto } from '../dto/enable-2fa.dto';
import { Verify2faDto } from '../dto/verify-2fa.dto';

const BACKUP_CODE_COUNT = 10;
// const BACKUP_CODE_LENGTH = 10;
const BCRYPT_ROUNDS = 12;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const TOTP_WINDOW = 1; // ±1 period (30s each side)
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

@Injectable()
export class TwoFactorService {
  private readonly encryptionKey: Buffer;

  constructor(
    @InjectRepository(TwoFactor)
    private readonly twoFactorRepo: Repository<TwoFactor>,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    const key = this.configService.get<string>('TWO_FACTOR_ENCRYPTION_KEY');
    if (!key || Buffer.from(key, 'hex').length !== 32) {
      throw new Error(
        'TWO_FACTOR_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)',
      );
    }
    this.encryptionKey = Buffer.from(key, 'hex');
  }

  // ─── Encryption Helpers ──────────────────────────────────────────────────────

  private encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      ENCRYPTION_ALGORITHM,
      this.encryptionKey,
      iv,
    );
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    // Format: iv:tag:ciphertext (all hex)
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(ciphertext: string): string {
    const [ivHex, tagHex, encHex] = ciphertext.split(':');
    if (!ivHex || !tagHex || !encHex) {
      throw new Error('Malformed encrypted secret');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      this.encryptionKey,
      iv,
    );
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  // ─── Rate Limiting ───────────────────────────────────────────────────────────

  private async checkRateLimit(userId: string): Promise<void> {
    const key = `2fa_attempts:${userId}`;
    const attempts = (await this.cacheManager.get<number>(key)) ?? 0;
    if (attempts >= RATE_LIMIT_MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        `Too many 2FA attempts. Please wait ${RATE_LIMIT_WINDOW_SECONDS}s before retrying.`,
      );
    }
    await this.cacheManager.set(
      key,
      attempts + 1,
      RATE_LIMIT_WINDOW_SECONDS * 1000,
    );
  }

  private async clearRateLimit(userId: string): Promise<void> {
    await this.cacheManager.del(`2fa_attempts:${userId}`);
  }

  // ─── Enrollment ──────────────────────────────────────────────────────────────

  /**
   * Step 1 – Generate a TOTP secret and return a QR code data-URL.
   * The secret is stored but 2FA is NOT yet enabled until the user confirms
   * a valid code via confirmEnrollment().
   */
  async initiateEnrollment(
    userId: string,
    userEmail: string,
  ): Promise<{ qrCodeDataUrl: string; manualEntryKey: string }> {
    const existing = await this.twoFactorRepo.findOne({ where: { userId } });
    if (existing?.enabled) {
      throw new BadRequestException('2FA is already enabled for this account.');
    }

    // Generate a new TOTP secret
    const secretObj = speakeasy.generateSecret({
      name: `StellarSwipe (${userEmail})`,
      issuer: 'StellarSwipe',
      length: 20,
    });

    const encryptedSecret = this.encrypt(secretObj.base32);

    if (existing) {
      existing.secret = encryptedSecret;
      existing.enabled = false;
      await this.twoFactorRepo.save(existing);
    } else {
      const record = this.twoFactorRepo.create({
        userId,
        secret: encryptedSecret,
        backupCodes: [],
        enabled: false,
      });
      await this.twoFactorRepo.save(record);
    }

    const otpauthUrl = secretObj.otpauth_url!;
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    return {
      qrCodeDataUrl,
      manualEntryKey: secretObj.base32,
    };
  }

  /**
   * Step 2 – Verify the first TOTP code to confirm enrollment, then
   * generate and return hashed backup codes.
   */
  async confirmEnrollment(
    userId: string,
    dto: Enable2faDto,
  ): Promise<{ backupCodes: string[] }> {
    const record = await this.twoFactorRepo.findOne({ where: { userId } });
    if (!record) {
      throw new NotFoundException(
        'No pending 2FA enrollment found. Please initiate enrollment first.',
      );
    }
    if (record.enabled) {
      throw new BadRequestException('2FA is already enabled.');
    }

    await this.checkRateLimit(userId);

    const secret = this.decrypt(record.secret);
    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: dto.token,
      window: TOTP_WINDOW,
    });

    if (!verified) {
      throw new UnauthorizedException(
        'Invalid TOTP code. Please ensure your device time is synced and try again.',
      );
    }

    await this.clearRateLimit(userId);

    // Generate 10 plaintext backup codes and store hashed versions
    const plaintextCodes = this.generateBackupCodes();
    const hashedCodes = await Promise.all(
      plaintextCodes.map((code) => bcrypt.hash(code, BCRYPT_ROUNDS)),
    );

    record.backupCodes = hashedCodes;
    record.enabled = true;
    record.enabledAt = new Date();
    await this.twoFactorRepo.save(record);

    // Return plaintext codes only once — user must save them immediately
    return { backupCodes: plaintextCodes };
  }

  // ─── Verification ────────────────────────────────────────────────────────────

  /**
   * Verify a TOTP token or backup code for a user.
   * Used as middleware enforcement for sensitive actions.
   */
  async verify(userId: string, dto: Verify2faDto): Promise<void> {
    const record = await this.twoFactorRepo.findOne({ where: { userId } });
    if (!record?.enabled) return; // 2FA not enabled — no enforcement needed

    await this.checkRateLimit(userId);

    if (dto.token) {
      const secret = this.decrypt(record.secret);
      const verified = speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token: dto.token,
        window: TOTP_WINDOW,
      });

      if (!verified) {
        throw new UnauthorizedException('Invalid or expired TOTP code.');
      }

      await this.clearRateLimit(userId);
      return;
    }

    if (dto.backupCode) {
      const matchIndex = await this.findMatchingBackupCode(
        dto.backupCode,
        record.backupCodes,
      );
      if (matchIndex === -1) {
        throw new UnauthorizedException('Invalid backup code.');
      }

      // Consume backup code (one-time use)
      record.backupCodes.splice(matchIndex, 1);
      await this.twoFactorRepo.save(record);

      await this.clearRateLimit(userId);

      if (record.backupCodes.length === 0) {
        // Surface a warning — in production, send an email notification here
        throw new UnauthorizedException(
          'All backup codes have been used. Please disable and re-enable 2FA to generate new codes.',
        );
      }
      return;
    }

    throw new BadRequestException(
      'Provide either a TOTP token or a backup code.',
    );
  }

  /**
   * Check whether 2FA is currently enabled for a user.
   */
  async isEnabled(userId: string): Promise<boolean> {
    const record = await this.twoFactorRepo.findOne({ where: { userId } });
    return record?.enabled ?? false;
  }

  // ─── Disable / Recovery ──────────────────────────────────────────────────────

  /**
   * Disable 2FA for a user. Requires a valid TOTP or backup code first.
   */
  async disable(userId: string, dto: Verify2faDto): Promise<void> {
    // Re-use verify to ensure the user proves possession before disabling
    await this.verify(userId, dto);

    const record = await this.twoFactorRepo.findOne({ where: { userId } });
    if (!record) return;

    record.enabled = false;
    record.enabledAt = undefined;
    record.secret = '';
    record.backupCodes = [];
    await this.twoFactorRepo.save(record);
  }

  /**
   * Regenerate backup codes. Requires valid TOTP verification.
   */
  async regenerateBackupCodes(
    userId: string,
    dto: Verify2faDto,
  ): Promise<{ backupCodes: string[] }> {
    await this.verify(userId, dto);

    const record = await this.twoFactorRepo.findOne({ where: { userId } });
    if (!record?.enabled) {
      throw new BadRequestException('2FA is not enabled.');
    }

    const plaintextCodes = this.generateBackupCodes();
    record.backupCodes = await Promise.all(
      plaintextCodes.map((code) => bcrypt.hash(code, BCRYPT_ROUNDS)),
    );
    await this.twoFactorRepo.save(record);

    return { backupCodes: plaintextCodes };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private generateBackupCodes(): string[] {
    return Array.from(
      { length: BACKUP_CODE_COUNT },
      () => crypto.randomBytes(5).toString('hex').toUpperCase(), // 10-char hex string
    );
  }

  private async findMatchingBackupCode(
    provided: string,
    hashed: string[],
  ): Promise<number> {
    const results = await Promise.all(
      hashed.map((hash) => bcrypt.compare(provided, hash)),
    );
    return results.findIndex(Boolean);
  }
}
