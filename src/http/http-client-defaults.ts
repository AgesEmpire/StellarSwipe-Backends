import { HttpModuleOptions } from '@nestjs/axios';

/**
 * Shared axios defaults for every outbound HTTP client in the app.
 * A finite response timeout is mandatory — axios has no separate
 * "connect" timeout distinct from the overall request timeout, so this
 * single value bounds connect + response together.
 */
export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
export const DEFAULT_HTTP_MAX_REDIRECTS = 3;

export function defaultHttpModuleOptions(overrides: HttpModuleOptions = {}): HttpModuleOptions {
  return {
    timeout: DEFAULT_HTTP_TIMEOUT_MS,
    maxRedirects: DEFAULT_HTTP_MAX_REDIRECTS,
    ...overrides,
  };
}
