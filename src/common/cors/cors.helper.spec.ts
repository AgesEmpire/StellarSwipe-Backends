import { createCorsOptions } from './cors.helper';

describe('createCorsOptions', () => {
  it('throws when production and no allowlist', () => {
    expect(() => createCorsOptions([], true, 'mainnet')).toThrow();
  });

  it('allows explicit origin', (done) => {
    const opts = createCorsOptions(['https://example.com'], true, 'mainnet');
    const checker = opts.origin as any;
    checker('https://example.com', (err: any, allow: boolean) => {
      expect(err).toBeNull();
      expect(allow).toBe(true);
      done();
    });
  });

  it('rejects disallowed origin', (done) => {
    const opts = createCorsOptions(['https://foo.com'], true, 'production');
    const checker = opts.origin as any;
    checker('https://bar.com', (err: any, allow: boolean) => {
      expect(err).toBeInstanceOf(Error);
      expect(allow).toBeUndefined();
      done();
    });
  });

  it('includes required methods and allowedHeaders', () => {
    const opts = createCorsOptions(['https://example.com'], true, 'production');
    expect(opts.methods).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
    expect(opts.allowedHeaders).toContain('Authorization');
    expect(opts.allowedHeaders).toContain('X-Correlation-ID');
    expect(opts.allowedHeaders).toContain('Idempotency-Key');
  });

  it('sets credentials: true for listed origins', () => {
    const opts = createCorsOptions(['https://example.com'], true, 'production');
    expect(opts.credentials).toBe(true);
  });

  it('allows non-browser requests (no origin)', (done) => {
    const opts = createCorsOptions(['https://example.com'], true, 'production');
    const checker = opts.origin as any;
    checker(undefined, (err: any, allow: boolean) => {
      expect(err).toBeNull();
      expect(allow).toBe(true);
      done();
    });
  });
});
