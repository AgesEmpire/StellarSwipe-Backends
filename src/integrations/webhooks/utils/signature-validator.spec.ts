import * as crypto from 'crypto';
import {
  isHexSignature,
  parseSignatureHeader,
  verifyHmacSignature,
  verifyRotatingHmacSignature,
} from './signature-validator';

const hmac = (secret: string, message: string, algorithm: 'sha256' | 'sha512' = 'sha256') =>
  crypto.createHmac(algorithm, secret).update(message).digest('hex');

describe('isHexSignature', () => {
  it('accepts even-length lowercase hex', () => {
    expect(isHexSignature('abcd1234')).toBe(true);
  });

  it('accepts even-length uppercase hex', () => {
    expect(isHexSignature('ABCD1234')).toBe(true);
  });

  it('rejects odd-length strings', () => {
    expect(isHexSignature('abc')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isHexSignature('not-hex')).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(isHexSignature('')).toBe(false);
  });
});

describe('parseSignatureHeader', () => {
  it('returns null for undefined/empty headers', () => {
    expect(parseSignatureHeader(undefined)).toBeNull();
    expect(parseSignatureHeader('')).toBeNull();
    expect(parseSignatureHeader('   ')).toBeNull();
  });

  it('parses a raw sha256= prefixed header', () => {
    expect(parseSignatureHeader('sha256=deadbeef')).toEqual({ signature: 'deadbeef' });
  });

  it('parses a raw sha512= prefixed header', () => {
    expect(parseSignatureHeader('sha512=deadbeef')).toEqual({ signature: 'deadbeef' });
  });

  it('parses a bare hex header with no prefix', () => {
    expect(parseSignatureHeader('deadbeef')).toEqual({ signature: 'deadbeef' });
  });

  it('parses a timestamped t=,v1= header', () => {
    expect(parseSignatureHeader('t=1700000000,v1=deadbeef')).toEqual({
      timestamp: 1700000000,
      signature: 'deadbeef',
    });
  });

  it('tolerates whitespace around timestamped components', () => {
    expect(parseSignatureHeader('t=1700000000, v1=deadbeef')).toEqual({
      timestamp: 1700000000,
      signature: 'deadbeef',
    });
  });

  it('returns null for a timestamped header missing v1', () => {
    expect(parseSignatureHeader('t=1700000000')).toBeNull();
  });

  it('returns null for a timestamped header with a non-numeric timestamp', () => {
    expect(parseSignatureHeader('t=notanumber,v1=deadbeef')).toBeNull();
  });
});

describe('verifyRotatingHmacSignature', () => {
  const body = JSON.stringify({ event: 'payment.completed', amount: 100 });

  it('matches against the first (current) secret', () => {
    const signature = 'sha256=' + hmac('current-secret', body);
    const result = verifyRotatingHmacSignature(body, signature, ['current-secret', 'previous-secret']);
    expect(result).toEqual({ valid: true, matchedSecretIndex: 0, timestamp: undefined });
  });

  it('matches against a later (previous) secret during rotation', () => {
    const signature = 'sha256=' + hmac('previous-secret', body);
    const result = verifyRotatingHmacSignature(body, signature, ['current-secret', 'previous-secret']);
    expect(result).toEqual({ valid: true, matchedSecretIndex: 1, timestamp: undefined });
  });

  it('rejects a signature that matches none of the configured secrets', () => {
    const signature = 'sha256=' + hmac('unknown-secret', body);
    const result = verifyRotatingHmacSignature(body, signature, ['current-secret', 'previous-secret']);
    expect(result.valid).toBe(false);
    expect(result.matchedSecretIndex).toBe(-1);
  });

  it('returns invalid when the secrets list is empty', () => {
    const signature = 'sha256=' + hmac('current-secret', body);
    expect(verifyRotatingHmacSignature(body, signature, [])).toEqual({
      valid: false,
      matchedSecretIndex: -1,
      timestamp: undefined,
    });
  });

  it('returns invalid for an empty raw body', () => {
    const signature = 'sha256=' + hmac('current-secret', '');
    expect(verifyRotatingHmacSignature('', signature, ['current-secret']).valid).toBe(false);
  });

  it('returns invalid for a malformed signature header', () => {
    expect(verifyRotatingHmacSignature(body, 'garbage', ['current-secret']).valid).toBe(false);
  });

  it('verifies timestamped signatures against `${timestamp}.${body}`', () => {
    const timestamp = 1700000000;
    const signature = `t=${timestamp},v1=${hmac('current-secret', `${timestamp}.${body}`)}`;
    const result = verifyRotatingHmacSignature(body, signature, ['current-secret']);
    expect(result).toEqual({ valid: true, matchedSecretIndex: 0, timestamp });
  });

  it('still reports the parsed timestamp even when no secret matches', () => {
    const timestamp = 1700000000;
    const signature = `t=${timestamp},v1=${hmac('wrong-secret', `${timestamp}.${body}`)}`;
    const result = verifyRotatingHmacSignature(body, signature, ['current-secret']);
    expect(result.valid).toBe(false);
    expect(result.timestamp).toBe(timestamp);
  });

  it('supports sha512', () => {
    const signature = hmac('current-secret', body, 'sha512');
    const result = verifyRotatingHmacSignature(body, signature, ['current-secret'], 'sha512');
    expect(result.valid).toBe(true);
  });
});

describe('verifyHmacSignature (backward-compatible single-secret helper)', () => {
  it('validates a matching signature', () => {
    const body = '{"a":1}';
    const signature = 'sha256=' + hmac('secret', body);
    expect(verifyHmacSignature(body, signature, 'secret')).toBe(true);
  });

  it('rejects a non-matching signature', () => {
    const body = '{"a":1}';
    const signature = 'sha256=' + hmac('wrong', body);
    expect(verifyHmacSignature(body, signature, 'secret')).toBe(false);
  });

  it('returns false for any missing argument', () => {
    expect(verifyHmacSignature('', 'sha256=abcd', 'secret')).toBe(false);
    expect(verifyHmacSignature('{}', '', 'secret')).toBe(false);
    expect(verifyHmacSignature('{}', 'sha256=abcd', '')).toBe(false);
  });
});
