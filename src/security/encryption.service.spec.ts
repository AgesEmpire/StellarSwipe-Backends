import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';
import { EncryptedColumnTransformer, encryptedColumn } from './encrypted-column.transformer';

const VALID_KEY = 'a-sufficiently-long-encryption-key-for-tests!!';
const ROTATED_KEY = 'a-brand-new-post-rotation-encryption-key-here!!';

function makeService(key = VALID_KEY): EncryptionService {
  const config = { get: jest.fn().mockReturnValue(key) } as unknown as ConfigService;
  return new EncryptionService(config);
}

function makeServiceWithRotation(currentKey: string, previousKeys: string): EncryptionService {
  const config = {
    get: jest.fn((name: string) =>
      name === 'ENCRYPTION_KEY_PREVIOUS' ? previousKeys : currentKey,
    ),
  } as unknown as ConfigService;
  return new EncryptionService(config);
}

// ── EncryptionService ─────────────────────────────────────────────────────────

describe('EncryptionService', () => {
  let svc: EncryptionService;

  beforeEach(() => {
    svc = makeService();
  });

  it('encrypts a string and returns iv:tag:ciphertext format', () => {
    const result = svc.encrypt('hello');
    const parts = result.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(24); // 12-byte IV → 24 hex chars
    expect(parts[1]).toHaveLength(32); // 16-byte tag → 32 hex chars
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it('decrypts back to the original plaintext', () => {
    const plaintext = 'sensitive-token-abc123';
    expect(svc.decrypt(svc.encrypt(plaintext))).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const a = svc.encrypt('same');
    const b = svc.encrypt('same');
    expect(a).not.toBe(b);
    // But both decrypt correctly
    expect(svc.decrypt(a)).toBe('same');
    expect(svc.decrypt(b)).toBe('same');
  });

  it('handles unicode and long strings', () => {
    const long = '🔐'.repeat(200) + 'end';
    expect(svc.decrypt(svc.encrypt(long))).toBe(long);
  });

  it('throws on tampered ciphertext (auth tag mismatch)', () => {
    const ct = svc.encrypt('secret');
    const parts = ct.split(':');
    // Flip one byte in the ciphertext
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('ff') ? '00' : 'ff');
    expect(() => svc.decrypt(parts.join(':'))).toThrow();
  });

  it('throws on malformed ciphertext (wrong number of parts)', () => {
    expect(() => svc.decrypt('notvalid')).toThrow('Invalid ciphertext format');
    expect(() => svc.decrypt('a:b')).toThrow('Invalid ciphertext format');
  });

  it('throws on short IV or tag', () => {
    expect(() => svc.decrypt('aabb:ccdd:eeff')).toThrow('Invalid ciphertext format');
  });

  it('throws when ENCRYPTION_KEY is too short', () => {
    expect(() => makeService('short')).toThrow('ENCRYPTION_KEY must be at least 32 characters');
  });

  it('isEncrypted returns true for valid ciphertext', () => {
    expect(svc.isEncrypted(svc.encrypt('x'))).toBe(true);
  });

  it('isEncrypted returns false for plain strings', () => {
    expect(svc.isEncrypted('plain-text')).toBe(false);
    expect(svc.isEncrypted('a:b:c')).toBe(false); // wrong lengths
  });
});

// ── Key rotation ───────────────────────────────────────────────────────────────

describe('EncryptionService key rotation', () => {
  it('decrypts ciphertext from the current key when no previous keys are configured', () => {
    const svc = makeServiceWithRotation(VALID_KEY, '');
    const ciphertext = svc.encrypt('rotation-test');
    expect(svc.decrypt(ciphertext)).toBe('rotation-test');
  });

  it('decrypts ciphertext written under a retired key after rotation', () => {
    // Simulate data encrypted before the rotation.
    const preRotation = makeService(VALID_KEY);
    const legacyCiphertext = preRotation.encrypt('old-secret');

    // After rotation: ENCRYPTION_KEY is now ROTATED_KEY, and the old key is
    // preserved in ENCRYPTION_KEY_PREVIOUS.
    const postRotation = makeServiceWithRotation(ROTATED_KEY, VALID_KEY);

    expect(postRotation.decrypt(legacyCiphertext)).toBe('old-secret');
  });

  it('encrypts new values under the current (rotated) key, not the previous one', () => {
    const postRotation = makeServiceWithRotation(ROTATED_KEY, VALID_KEY);
    const ciphertext = postRotation.encrypt('new-secret');

    // A service that only knows the old key must not be able to decrypt it.
    const oldKeyOnly = makeService(VALID_KEY);
    expect(() => oldKeyOnly.decrypt(ciphertext)).toThrow();

    // But the rotated service (current key) can.
    expect(postRotation.decrypt(ciphertext)).toBe('new-secret');
  });

  it('supports multiple comma-separated previous keys', () => {
    const veryOldKey = 'a-very-old-encryption-key-from-two-rotations-ago!!';
    const veryOldService = makeService(veryOldKey);
    const veryOldCiphertext = veryOldService.encrypt('ancient-secret');

    const current = makeServiceWithRotation(
      ROTATED_KEY,
      `${VALID_KEY}, ${veryOldKey}`,
    );

    expect(current.decrypt(veryOldCiphertext)).toBe('ancient-secret');
  });

  it('throws when no key (current or previous) can decrypt the ciphertext', () => {
    const unrelatedKey = 'a-totally-unrelated-encryption-key-value-here!!';
    const unrelatedService = makeService(unrelatedKey);
    const ciphertext = unrelatedService.encrypt('unreadable');

    const current = makeServiceWithRotation(ROTATED_KEY, VALID_KEY);
    expect(() => current.decrypt(ciphertext)).toThrow();
  });

  describe('reEncrypt', () => {
    it('re-wraps ciphertext from a previous key under the current key', () => {
      const preRotation = makeService(VALID_KEY);
      const legacyCiphertext = preRotation.encrypt('migrate-me');

      const postRotation = makeServiceWithRotation(ROTATED_KEY, VALID_KEY);
      const migrated = postRotation.reEncrypt(legacyCiphertext);

      // Migrated ciphertext still decrypts to the same plaintext...
      expect(postRotation.decrypt(migrated)).toBe('migrate-me');
      // ...but is no longer decryptable using only the old key.
      const oldKeyOnly = makeService(VALID_KEY);
      expect(() => oldKeyOnly.decrypt(migrated)).toThrow();
    });
  });
});

// ── EncryptedColumnTransformer ────────────────────────────────────────────────

describe('EncryptedColumnTransformer', () => {
  let svc: EncryptionService;

  beforeEach(() => {
    svc = makeService();
    EncryptedColumnTransformer.init(svc);
  });

  it('to() encrypts a plaintext value', () => {
    const t = encryptedColumn();
    const result = t.to('my-token');
    expect(result).toBeDefined();
    expect(svc.isEncrypted(result!)).toBe(true);
  });

  it('from() decrypts back to plaintext', () => {
    const t = encryptedColumn();
    const encrypted = t.to('my-token')!;
    expect(t.from(encrypted)).toBe('my-token');
  });

  it('to() passes through null', () => {
    expect(encryptedColumn().to(null)).toBeNull();
  });

  it('to() passes through undefined', () => {
    expect(encryptedColumn().to(undefined)).toBeUndefined();
  });

  it('from() passes through null', () => {
    expect(encryptedColumn().from(null)).toBeNull();
  });

  it('from() passes through undefined', () => {
    expect(encryptedColumn().from(undefined)).toBeUndefined();
  });

  it('to() does not double-encrypt an already-encrypted value', () => {
    const t = encryptedColumn();
    const once = t.to('value')!;
    const twice = t.to(once)!;
    // Should still decrypt to the original value
    expect(t.from(twice)).toBe('value');
    // And the two ciphertexts should be the same (no double-wrap)
    expect(twice).toBe(once);
  });

  it('from() returns a non-encrypted string as-is (migration safety)', () => {
    // Existing plaintext rows that haven't been migrated yet should pass through
    expect(encryptedColumn().from('plain-legacy-value')).toBe('plain-legacy-value');
  });

  it('throws when not initialised', () => {
    // Reset the static service
    EncryptedColumnTransformer.init(null as any);
    const t = encryptedColumn();
    expect(() => t.to('x')).toThrow('EncryptedColumnTransformer not initialised');
    expect(() => t.from('x')).toThrow('EncryptedColumnTransformer not initialised');
    // Restore for other tests
    EncryptedColumnTransformer.init(svc);
  });
});
