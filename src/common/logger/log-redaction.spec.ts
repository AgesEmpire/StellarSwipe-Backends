import { redactSensitiveFields } from './log-redaction';

describe('redactSensitiveFields', () => {
  afterEach(() => {
    delete process.env.REDACT_FULL_FIELDS;
    delete process.env.REDACT_PARTIAL_FIELDS;
  });

  // ── primitives & non-objects ────────────────────────────────────────────────

  it('returns primitives unchanged', () => {
    expect(redactSensitiveFields(42)).toBe(42);
    expect(redactSensitiveFields('hello')).toBe('hello');
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields(true)).toBe(true);
  });

  // ── non-sensitive fields ───────────────────────────────────────────────────

  it('leaves non-sensitive fields untouched', () => {
    const obj = { userId: 'abc', amount: 100, status: 'active' };
    expect(redactSensitiveFields(obj)).toEqual(obj);
  });

  // ── full redaction ─────────────────────────────────────────────────────────

  it('fully redacts password', () => {
    const result = redactSensitiveFields({ password: 's3cr3t' }) as any;
    expect(result.password).toBe('[REDACTED]');
  });

  it('fully redacts token fields', () => {
    const result = redactSensitiveFields({
      token: 'tok123',
      accessToken: 'at-abc',
      refreshToken: 'rt-xyz',
    }) as any;
    expect(result.token).toBe('[REDACTED]');
    expect(result.accessToken).toBe('[REDACTED]');
    expect(result.refreshToken).toBe('[REDACTED]');
  });

  it('fully redacts secret / apiKey / privateKey', () => {
    const result = redactSensitiveFields({
      secret: 'shhh',
      apiKey: 'key-1234',
      privateKey: 'pk',
    }) as any;
    expect(result.secret).toBe('[REDACTED]');
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.privateKey).toBe('[REDACTED]');
  });

  it('fully redacts authorization header', () => {
    const result = redactSensitiveFields({
      authorization: 'Bearer tok',
    }) as any;
    expect(result.authorization).toBe('[REDACTED]');
  });

  it('fully redacts fields that contain sensitive keywords (case-insensitive key)', () => {
    const result = redactSensitiveFields({ UserPassword: 'abc' }) as any;
    expect(result.UserPassword).toBe('[REDACTED]');
  });

  // ── partial masking ────────────────────────────────────────────────────────

  it('partially masks email — keeps last 4 chars', () => {
    const result = redactSensitiveFields({
      email: 'alice@example.com',
    }) as any;
    expect(result.email).toBe('****.com');
  });

  it('fully redacts email when value is 4 chars or shorter', () => {
    const result = redactSensitiveFields({ email: 'a@b' }) as any;
    expect(result.email).toBe('[REDACTED]');
  });

  it('partially masks walletAddress', () => {
    const result = redactSensitiveFields({
      walletAddress: 'GABCDEF1234567890',
    }) as any;
    expect(result.walletAddress).toMatch(/^\*{4}.{4}$/);
    expect(result.walletAddress.slice(-4)).toBe('7890');
  });

  it('partially masks phone', () => {
    const result = redactSensitiveFields({ phone: '+1-800-555-0199' }) as any;
    expect(result.phone).toBe('****0199');
  });

  // ── recursive / nested ────────────────────────────────────────────────────

  it('recursively redacts nested objects', () => {
    const obj = {
      user: {
        id: 'u1',
        credentials: { password: 'pw', apiKey: 'k1' },
      },
    };
    const result = redactSensitiveFields(obj) as any;
    expect(result.user.id).toBe('u1');
    expect(result.user.credentials.password).toBe('[REDACTED]');
    expect(result.user.credentials.apiKey).toBe('[REDACTED]');
  });

  it('recursively handles arrays', () => {
    const obj = { tokens: ['tok1', 'tok2'] };
    // The key "tokens" matches "token"
    const result = redactSensitiveFields(obj) as any;
    expect(result.tokens).toBe('[REDACTED]');
  });

  it('walks arrays of objects', () => {
    const arr = [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
    ];
    const result = redactSensitiveFields(arr) as any[];
    expect(result[0].name).toBe('Alice');
    expect(result[0].email).toMatch(/^\*{4}/);
    expect(result[1].email).toMatch(/^\*{4}/);
  });

  // ── circular reference ────────────────────────────────────────────────────

  it('handles circular references without throwing', () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const result = redactSensitiveFields(obj) as any;
    expect(result.a).toBe(1);
    expect(result.self).toBe('[Circular]');
  });

  // ── configurable via env ──────────────────────────────────────────────────

  it('respects REDACT_FULL_FIELDS env for additional full redaction', () => {
    process.env.REDACT_FULL_FIELDS = 'taxId, nationalId';
    const result = redactSensitiveFields({
      taxId: '123-45-6789',
      nationalId: 'N-987',
      name: 'Alice',
    }) as any;
    expect(result.taxId).toBe('[REDACTED]');
    expect(result.nationalId).toBe('[REDACTED]');
    expect(result.name).toBe('Alice');
  });

  it('respects REDACT_PARTIAL_FIELDS env for additional partial masking', () => {
    process.env.REDACT_PARTIAL_FIELDS = 'driverLicense';
    const result = redactSensitiveFields({
      driverLicense: 'DL-ABCDE1234',
    }) as any;
    expect(result.driverLicense).toBe('****1234');
  });

  // ── mixed object ──────────────────────────────────────────────────────────

  it('leaves non-sensitive fields alongside redacted ones intact', () => {
    const obj = {
      tradeId: 'tr-001',
      amount: 500,
      password: 'hunter2',
      walletAddress: 'GABCDE12345678',
      status: 'completed',
    };
    const result = redactSensitiveFields(obj) as any;
    expect(result.tradeId).toBe('tr-001');
    expect(result.amount).toBe(500);
    expect(result.password).toBe('[REDACTED]');
    expect(result.walletAddress).toMatch(/^\*{4}/);
    expect(result.status).toBe('completed');
  });
});
