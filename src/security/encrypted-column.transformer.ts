import { ValueTransformer } from 'typeorm';
import { EncryptionService } from './encryption.service';

/**
 * TypeORM ValueTransformer that transparently encrypts values before they are
 * written to the database and decrypts them when they are read back.
 *
 * Usage on an entity column:
 *
 *   @Column({ transformer: encryptedColumn() })
 *   sensitiveField: string;
 *
 * The transformer is a factory so each column gets its own instance, but all
 * instances share the single EncryptionService singleton injected at bootstrap.
 *
 * Call `EncryptedColumnTransformer.init(encryptionService)` once during module
 * initialisation (e.g. in SecurityModule.onModuleInit) before any entity is
 * read or written.
 */
export class EncryptedColumnTransformer implements ValueTransformer {
  private static service: EncryptionService | null = null;

  /** Called once by SecurityModule after the DI container is ready. */
  static init(service: EncryptionService): void {
    EncryptedColumnTransformer.service = service;
  }

  /** Encrypt before writing to DB. Passes through null/undefined unchanged. */
  to(value: string | null | undefined): string | null | undefined {
    if (value == null) return value;
    if (!EncryptedColumnTransformer.service) {
      throw new Error('EncryptedColumnTransformer not initialised — call EncryptedColumnTransformer.init()');
    }
    // Avoid double-encrypting if the value is already an encrypted payload
    if (EncryptedColumnTransformer.service.isEncrypted(value)) return value;
    return EncryptedColumnTransformer.service.encrypt(value);
  }

  /** Decrypt after reading from DB. Passes through null/undefined unchanged. */
  from(value: string | null | undefined): string | null | undefined {
    if (value == null) return value;
    if (!EncryptedColumnTransformer.service) {
      throw new Error('EncryptedColumnTransformer not initialised — call EncryptedColumnTransformer.init()');
    }
    if (!EncryptedColumnTransformer.service.isEncrypted(value)) return value;
    return EncryptedColumnTransformer.service.decrypt(value);
  }
}

/** Convenience factory — returns a new transformer instance for a column. */
export function encryptedColumn(): EncryptedColumnTransformer {
  return new EncryptedColumnTransformer();
}
