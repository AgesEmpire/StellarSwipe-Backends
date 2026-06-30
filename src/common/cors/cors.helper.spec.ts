import { createCorsOptions } from './cors.helper';

describe('createCorsOptions', () => {
  it('throws when production and no allowlist', () => {
    expect(() => createCorsOptions([], true, 'mainnet')).toThrow();
  });

  it('allows explicit origin', (done) => {
    const opts = createCorsOptions(['https://example.com'], true, 'mainnet');
    // originChecker is function in opts.origin
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
});
