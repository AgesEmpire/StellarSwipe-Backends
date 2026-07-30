import { redactSensitiveText, deepRedactText } from './text-redaction';

describe('redactSensitiveText', () => {
  it('returns non-string input unchanged', () => {
    expect(redactSensitiveText(undefined as any)).toBeUndefined();
    expect(redactSensitiveText(null as any)).toBeNull();
    expect(redactSensitiveText(42 as any)).toBe(42);
  });

  it('returns empty string unchanged', () => {
    expect(redactSensitiveText('')).toBe('');
  });

  it('leaves plain, non-sensitive text untouched (non-redacted path)', () => {
    const message = 'Trade executed successfully at market price';
    expect(redactSensitiveText(message)).toBe(message);
  });

  it('redacts an email address embedded in a sentence', () => {
    const message = 'Failed to notify user at jane.doe@example.com about the outage';
    const result = redactSensitiveText(message);
    expect(result).not.toContain('jane.doe@example.com');
    expect(result).toContain('[REDACTED_EMAIL]');
  });

  it('redacts a Stellar public key embedded in a sentence', () => {
    const key = 'G'.padEnd(56, 'A');
    const message = `Top up your wallet at ${key} to continue trading.`;
    const result = redactSensitiveText(message);
    expect(result).not.toContain(key);
    expect(result).toContain('[REDACTED_STELLAR_KEY]');
  });

  it('redacts a Stellar secret key embedded in a sentence', () => {
    const key = 'S'.padEnd(56, 'B');
    const message = `Signing failed for secret ${key}`;
    const result = redactSensitiveText(message);
    expect(result).not.toContain(key);
    expect(result).toContain('[REDACTED_STELLAR_KEY]');
  });

  it('redacts a credit-card-like number', () => {
    const message = 'Charge declined for card 4111 1111 1111 1111';
    const result = redactSensitiveText(message);
    expect(result).not.toContain('4111 1111 1111 1111');
    expect(result).toContain('[REDACTED_CARD_NUMBER]');
  });

  it('redacts a phone number', () => {
    const message = 'Contact the user at +1-800-555-0199 for verification';
    const result = redactSensitiveText(message);
    expect(result).not.toContain('+1-800-555-0199');
    expect(result).toContain('[REDACTED_PHONE]');
  });

  it('redacts multiple PII patterns in the same string', () => {
    const key = 'G'.padEnd(56, 'C');
    const message = `Notify jane@example.com about wallet ${key}`;
    const result = redactSensitiveText(message);
    expect(result).not.toContain('jane@example.com');
    expect(result).not.toContain(key);
  });

  it('is idempotent across repeated calls (global regex lastIndex does not leak state)', () => {
    const message = 'Contact jane@example.com';
    const first = redactSensitiveText(message);
    const second = redactSensitiveText(message);
    expect(first).toBe(second);
  });
});

describe('deepRedactText', () => {
  it('returns primitives unchanged', () => {
    expect(deepRedactText(42)).toBe(42);
    expect(deepRedactText(true)).toBe(true);
    expect(deepRedactText(null)).toBeNull();
  });

  it('redacts string leaves inside nested objects (redacted path)', () => {
    const input = {
      note: 'reach out to jane.doe@example.com',
      nested: { detail: 'card 4111 1111 1111 1111 declined' },
    };
    const result = deepRedactText(input) as any;
    expect(result.note).toContain('[REDACTED_EMAIL]');
    expect(result.nested.detail).toContain('[REDACTED_CARD_NUMBER]');
  });

  it('leaves non-sensitive nested values untouched (non-redacted path)', () => {
    const input = { status: 'ok', count: 5, nested: { label: 'trade-executed' } };
    expect(deepRedactText(input)).toEqual(input);
  });

  it('redacts string leaves inside arrays', () => {
    const input = ['reach jane@example.com', 'no pii here'];
    const result = deepRedactText(input) as string[];
    expect(result[0]).toContain('[REDACTED_EMAIL]');
    expect(result[1]).toBe('no pii here');
  });

  it('replaces circular references instead of recursing infinitely', () => {
    const obj: any = { name: 'circular' };
    obj.self = obj;
    const result = deepRedactText(obj) as any;
    expect(result.self).toBe('[Circular]');
  });
});
