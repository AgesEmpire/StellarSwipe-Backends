import { defaultHttpModuleOptions, DEFAULT_HTTP_TIMEOUT_MS, DEFAULT_HTTP_MAX_REDIRECTS } from './http-client-defaults';

describe('defaultHttpModuleOptions', () => {
  it('returns the shared default timeout and maxRedirects when called with no overrides', () => {
    expect(defaultHttpModuleOptions()).toEqual({ timeout: 10_000, maxRedirects: 3 });
  });

  it('merges caller overrides on top of the defaults', () => {
    expect(defaultHttpModuleOptions({ timeout: 5000 })).toEqual({
      timeout: 5000,
      maxRedirects: 3,
    });
  });

  it('exposes the raw default constants', () => {
    expect(DEFAULT_HTTP_TIMEOUT_MS).toBe(10_000);
    expect(DEFAULT_HTTP_MAX_REDIRECTS).toBe(3);
  });
});
