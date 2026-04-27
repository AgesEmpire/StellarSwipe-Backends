import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';
import { EncryptedColumnTransformer, encryptedColumn } from './encrypted-column.transformer';

const VALID_KEY = 'a-sufficiently-long-encryption-key-for-tests!!';

function makeService(key = VALID_KEY): EncryptionService {
  const config = { get: jest.fn().mockReturnValue(key) } as unknown as ConfigService;
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
