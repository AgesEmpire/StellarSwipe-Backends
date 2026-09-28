import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV recommended for GCM
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const SALT = 'stellarswipe-enc-v1'; // static salt — key derivation only, not a secret

/**
 * EncryptionService — AES-256-GCM authenticated encryption for sensitive fields.
 *
 * Ciphertext format (all hex, colon-delimited):
 *   <iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * Key management:
 *   - Reads ENCRYPTION_KEY from environment (min 32 chars enforced by config schema).
 *   - Derives a 256-bit key via scrypt so the raw env value is never used directly.
 *   - Key is derived once at construction and held in memory.
 *
 * Key rotation:
 *   - Optional ENCRYPTION_KEY_PREVIOUS holds one or more retired keys
 *     (comma-separated) so ciphertext written before a rotation can still be
 *     decrypted. To rotate: move the current ENCRYPTION_KEY value into
 *     ENCRYPTION_KEY_PREVIOUS, set ENCRYPTION_KEY to a new value, and
 *     redeploy — decrypt() transparently falls back to the previous keys.
 *   - reEncrypt() re-wraps a ciphertext (decrypted with whichever key works)
 *     under the current key, for migrating stored data after a rotation.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer;
  private readonly previousKeys: Buffer[];

  constructor(private readonly config: ConfigService) {
    const rawKey = this.config.get<string>('ENCRYPTION_KEY');
    if (!rawKey || rawKey.length < 32) {
      throw new Error('ENCRYPTION_KEY must be at least 32 characters');
    }
    this.key = scryptSync(rawKey, SALT, KEY_BYTES) as Buffer;

    const rawPreviousKeys = this.config.get<string>('ENCRYPTION_KEY_PREVIOUS');
    this.previousKeys = (rawPreviousKeys ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length >= 32)
      .map((k) => scryptSync(k, SALT, KEY_BYTES) as Buffer);

    this.logger.log(
      `EncryptionService initialised${
        this.previousKeys.length ? ` (${this.previousKeys.length} previous key(s) available for rotation)` : ''
      }`,
    );
  }

  /**
   * Encrypt a plaintext string.
   * Returns a colon-delimited hex string: iv:authTag:ciphertext
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
  }

  /**
   * Decrypt a ciphertext produced by `encrypt()`.
   * Falls back through any configured previous keys (see ENCRYPTION_KEY_PREVIOUS)
   * so ciphertext written before a key rotation remains readable.
   * Throws if the auth tag is invalid against every known key (tampered data).
   */
  decrypt(ciphertext: string): string {
    const { iv, authTag, data } = this.parseCiphertext(ciphertext);

    try {
      return this.decryptWithKey(this.key, iv, authTag, data);
    } catch (error) {
      for (const previousKey of this.previousKeys) {
        try {
          return this.decryptWithKey(previousKey, iv, authTag, data);
        } catch {
          // try the next previous key
        }
      }
      throw error;
    }
  }

  /**
   * Re-encrypt a ciphertext under the current key. Decrypts using whichever
   * key (current or previous) succeeds, then re-wraps with the current key.
   * Used to migrate stored ciphertext after a key rotation.
   */
  reEncrypt(ciphertext: string): string {
    return this.encrypt(this.decrypt(ciphertext));
  }

  private parseCiphertext(ciphertext: string): { iv: Buffer; authTag: Buffer; data: Buffer } {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format');
    }
    const [ivHex, tagHex, dataHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');

    if (iv.length !== IV_BYTES || authTag.length !== TAG_BYTES) {
      throw new Error('Invalid ciphertext format');
    }

    return { iv, authTag, data };
  }

  private decryptWithKey(key: Buffer, iv: Buffer, authTag: Buffer, data: Buffer): string {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  /** Returns true when the value looks like an encrypted payload. */
  isEncrypted(value: string): boolean {
    const parts = value.split(':');
    return (
      parts.length === 3 &&
      parts[0].length === IV_BYTES * 2 &&
      parts[1].length === TAG_BYTES * 2
    );
  }
}
