import { registerAs } from '@nestjs/config';

/**
 * Parse a positive integer from an environment variable.
 * Returns the fallback when the value is missing or not a valid positive integer.
 */
const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

/**
 * Canonical public origin (issue #1397).
 *
 * Absolute URLs (email links, callback URLs, API-generated links) must be built
 * from a configured canonical origin rather than an untrusted Host or
 * forwarded-host header. The value is validated at startup so a malformed or
 * wildcard origin fails fast instead of silently producing attacker-controlled
 * links.
 */
const parseCanonicalOrigin = (value: string | undefined): string => {
  const raw = (value || '').trim();

  if (raw.length === 0) {
    return '';
  }

  try {
    const url = new URL(raw);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }

    // Reject wildcards and path/query/fragment components: only a bare origin
    // (scheme + host + optional port) is a valid canonical public origin.
    if (url.hostname.includes('*')) {
      return '';
    }

    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      return '';
    }

    return url.origin;
  } catch {
    return '';
  }
};

/**
 * Canonical public origin configuration (issue #1397).
 * Used to generate absolute URLs independent of request headers.
 */
const publicOrigin = {
  canonical: parseCanonicalOrigin(process.env.PUBLIC_ORIGIN),
};

/**
 * CORS origin normalization (issue #1399).
 *
 * Allowed origins are parsed from a comma-separated list and normalized to a
 * bare origin (scheme + host + optional port) so matching is exact. Entries
 * that are not valid absolute http(s) origins, or that contain wildcards, are
 * preserved verbatim so startup validation can reject them with an actionable
 * error instead of silently dropping them.
 */
const normalizeCorsOrigin = (value: string): string => {
  const raw = value.trim();

  if (raw.length === 0) {
    return '';
  }

  if (raw === '*') {
    return raw;
  }

  try {
    const url = new URL(raw);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return raw;
    }

    if (url.hostname.includes('*')) {
      return raw;
    }

    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      return raw;
    }

    return url.origin;
  } catch {
    return raw;
  }
};

/**
 * CORS configuration (issue #1399).
 *
 * Credentialed CORS must never be combined with wildcard origins: browsers
 * reject `Access-Control-Allow-Origin: *` when credentials are included, and
 * reflecting arbitrary origins would defeat the same-origin policy. The
 * combination is rejected at startup by validateConfiguration.
 */
const cors = {
  enabled: process.env.CORS_ENABLED !== 'false',
  credentials: process.env.CORS_CREDENTIALS === 'true',
  origins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => normalizeCorsOrigin(origin))
    .filter((origin) => origin.length > 0),
};

/**
 * Request payload and parameter size limits (issue #1166).
 * All limits are configurable via environment variables and enforced
 * consistently across transports before expensive processing occurs.
 */
const requestLimits = {
  jsonBody: parsePositiveInt(process.env.REQUEST_LIMIT_JSON_BODY, 1 * 1024 * 1024),
  multipartUpload: parsePositiveInt(process.env.REQUEST_LIMIT_MULTIPART_UPLOAD, 10 * 1024 * 1024),
  queryString: parsePositiveInt(process.env.REQUEST_LIMIT_QUERY_STRING, 2 * 1024),
  headers: parsePositiveInt(process.env.REQUEST_LIMIT_HEADERS, 8 * 1024),
  routeParameter: parsePositiveInt(process.env.REQUEST_LIMIT_ROUTE_PARAMETER, 256),
};

/**
 * Runtime credential rotation (issue #1165).
 *
 * Credentials are refreshed at runtime without restarting the process. The
 * rotation is atomic: new operations immediately observe the replacement
 * credential, while in-flight operations may continue using the previous
 * credential for a bounded overlap window before it is discarded.
 *
 * Only non-sensitive metadata is exposed for observability; secret values are
 * never logged or emitted in telemetry.
 */
const secretsRotation = {
  // Master switch for runtime credential refresh.
  enabled: process.env.SECRETS_ROTATION_ENABLED !== 'false',
  // How long the previous credential remains valid for in-flight work after a
  // successful rotation, in milliseconds. Bounded to avoid unbounded overlap.
  overlapMs: parsePositiveInt(process.env.SECRETS_ROTATION_OVERLAP_MS, 30_000),
  // Maximum time to wait for in-flight operations to drain before the previous
  // credential is force-discarded, in milliseconds.
  drainTimeoutMs: parsePositiveInt(process.env.SECRETS_ROTATION_DRAIN_TIMEOUT_MS, 60_000),
  // Interval between automatic rotation checks, in milliseconds. Set to 0 to
  // disable automatic rotation and rely on explicit/manual rotation only.
  checkIntervalMs: parsePositiveInt(process.env.SECRETS_ROTATION_CHECK_INTERVAL_MS, 60_000),
  // Names of the credentials managed by the runtime store. Only names are
  // configured here; values are resolved from the environment at rotation time
  // and never persisted in configuration output.
  managed: (process.env.SECRETS_ROTATION_MANAGED || '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0),
};

/**
 * Production encryption and signing secrets (issue #1409).
 *
 * These values are read from the environment and validated at startup so a
 * misconfigured production deployment fails fast instead of running with weak
 * or placeholder key material. Development and test environments remain usable
 * without weakening the production checks.
 */
const encryptionSecrets = {
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  signingSecret: process.env.SIGNING_SECRET || '',
};

/**
 * Known placeholder values that must never be used as production secrets.
 */
const PLACEHOLDER_SECRETS = new Set([
  'changeme',
  'change-me',
  'change_me',
  'placeholder',
  'secret',
  'password',
  'example',
  'default',
  'test',
  'development',
  'your-secret-here',
  'your_secret_here',
  'replace-me',
  'replace_me',
  'todo',
  'xxx',
]);

/**
 * Minimum required length for production encryption/signing secrets.
 */
const MIN_SECRET_LENGTH = 32;

/**
 * Validate a single production secret, pushing actionable errors when the
 * value is empty, a known placeholder, or too short to be safe.
 */
const validateProductionSecret = (
  name: string,
  value: string,
  errors: string[],
): void => {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    errors.push(`${name} must be set to a non-empty value in production.`);
    return;
  }

  if (PLACEHOLDER_SECRETS.has(trimmed.toLowerCase())) {
    errors.push(`${name} must not be a known placeholder value in production.`);
    return;
  }

  if (trimmed.length < MIN_SECRET_LENGTH) {
    errors.push(
      `${name} must be at least ${MIN_SECRET_LENGTH} characters in production (received: ${trimmed.length}).`,
    );
  }
};

/**
 * Validate a single CORS origin entry (issue #1399).
 * Returns an error message when the entry is not a valid absolute http(s)
 * origin, or when it contains a wildcard.
 */
const validateCorsOrigin = (origin: string): string | null => {
  if (origin === '*') {
    return 'CORS_ORIGINS must not contain the wildcard "*" origin.';
  }

  if (origin.includes('*')) {
    return `CORS_ORIGINS entry "${origin}" must not contain wildcards; list explicit origins instead.`;
  }

  try {
    const url = new URL(origin);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return `CORS_ORIGINS entry "${origin}" must use the http or https scheme.`;
    }

    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      return `CORS_ORIGINS entry "${origin}" must be a bare origin (scheme + host + optional port).`;
    }
  } catch {
    return `CORS_ORIGINS entry "${origin}" must be a valid absolute http(s) origin.`;
  }

  return null;
};

/**
 * Cross-field configuration relationships (issue #1232).
 * Validates dependencies between network endpoints, retry limits, and
 * timeout budgets so invalid combinations fail startup with actionable errors.
 */
export const validateConfiguration = (config: {
  env: string;
  port: number;
  publicOrigin: { canonical: string };
  cors: { enabled: boolean; credentials: boolean; origins: string[] };
  encryptionSecrets: { encryptionKey: string; signingSecret: string };
  rateLimit: {
    enabled: boolean;
    store: { type: string; url: string };
    onStoreError: string;
    policies: {
      public: { windowMs: number; max: number };
      auth: { windowMs: number; max: number };
      internal: { windowMs: number; max: number; skip: boolean };
    };
  };
}): void => {
  const errors: string[] = [];

  // Network endpoint: the port must be a usable TCP port.
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push(
      `PORT must be an integer between 1 and 65535 (received: ${config.port}).`,
    );
  }

  // Canonical public origin (issue #1397): required in production so generated
  // absolute URLs never depend on untrusted Host / X-Forwarded-Host headers.
  if (config.env === 'production' && config.publicOrigin.canonical.length === 0) {
    errors.push(
      'PUBLIC_ORIGIN must be set to a valid absolute http(s) origin (e.g. https://app.example.com) in production.',
    );
  }

  // CORS origins (issue #1399): every configured origin must be a valid bare
  // http(s) origin, and credentialed CORS must never be combined with a
  // wildcard origin.
  if (config.cors.enabled) {
    for (const origin of config.cors.origins) {
      const error = validateCorsOrigin(origin);

      if (error) {
        errors.push(error);
      }
    }

    if (config.cors.credentials && config.cors.origins.includes('*')) {
      errors.push(
        'CORS_CREDENTIALS cannot be enabled together with a wildcard CORS_ORIGINS entry; list explicit origins instead.',
      );
    }
  }

  // Production secrets: reject empty, placeholder, and undersized key material.
  // Development and test environments are intentionally exempt so local setups
  // remain usable without weakening the production checks.
  if (config.env === 'production') {
    validateProductionSecret('ENCRYPTION_KEY', config.encryptionSecrets.encryptionKey, errors);
    validateProductionSecret('SIGNING_SECRET', config.encryptionSecrets.signingSecret, errors);
  }

  // Network endpoint: the rate-limit store URL must be a valid URL when enabled.
  if (config.rateLimit.enabled) {
    try {
      // eslint-disable-next-line no-new
      new URL(config.rateLimit.store.url);
    } catch {
      errors.push(
        `RATE_LIMIT_STORE_URL must be a valid URL when rate limiting is enabled (received: ${config.rateLimit.store.url}).`,
      );
    }

    if (!['redis', 'memo

/* … truncated 1958 chars — edit only what you need near the top … */
