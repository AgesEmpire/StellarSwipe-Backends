import { AsyncLocalStorage } from 'async_hooks';

/**
 * Structured logging context contract.
 *
 * Every log emitted by controllers, services, jobs and exception filters
 * should carry these machine-readable fields so production diagnostics are
 * searchable and correlation/actor context is preserved across boundaries.
 */
export interface LogContext {
  /** Correlation id tying together all logs for a single request/job. */
  correlationId?: string;
  /** Authenticated actor, when known. */
  userId?: string;
  /** Logical module emitting the log (e.g. "users", "billing"). */
  module?: string;
  /** Action being performed (e.g. "createUser", "processPayment"). */
  action?: string;
  /** Arbitrary additional identifiers relevant to the log entry. */
  [key: string]: unknown;
}

/** Actionable metadata attached to error logs. */
export interface ErrorLogMetadata {
  errorType: string;
  errorMessage: string;
  stack?: string;
  [key: string]: unknown;
}

const REDACTED = '[REDACTED]';

/**
 * Keys whose values must never be written to logs in clear text.
 * Matching is case-insensitive and substring-based.
 */
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'credential',
  'privatekey',
  'private_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

/**
 * Recursively redact sensitive values from a context object so it is safe to
 * serialize into a log entry.
 */
export function redactSensitive<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value as object)) {
    return '[Circular]' as unknown as T;
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, seen)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactSensitive(entry, seen);
  }
  return result as T;
}

/**
 * Normalize an Error (or unknown thrown value) into actionable log metadata.
 */
export function toErrorMetadata(error: unknown): ErrorLogMetadata {
  if (error instanceof Error) {
    return {
      errorType: error.name || 'Error',
      errorMessage: error.message,
      stack: error.stack,
    };
  }

  return {
    errorType: typeof error,
    errorMessage: typeof error === 'string' ? error : JSON.stringify(error),
  };
}

/**
 * Request/job-scoped storage that preserves correlation and actor context
 * across async boundaries (controllers -> services -> jobs).
 */
const storage = new AsyncLocalStorage<LogContext>();

/**
 * Run a callback with the given structured logging context bound to it.
 */
export function runWithLogContext<T>(context: LogContext, callback: () => T): T {
  return storage.run({ ...context }, callback);
}

/**
 * Read the current structured logging context, if any.
 */
export function getLogContext(): LogContext | undefined {
  return storage.getStore();
}

/**
 * Merge additional fields into the current context for the duration of the
 * callback, preserving any existing correlation/actor context.
 */
export function withLogContext<T>(context: LogContext, callback: () => T): T {
  const current = storage.getStore() ?? {};
  return storage.run({ ...current, ...context }, callback);
}

/**
 * Build a structured log payload from the current context plus overrides.
 * Sensitive values are redacted before the payload is returned.
 */
export function buildLogContext(overrides: LogContext = {}): LogContext {
  const current = storage.getStore() ?? {};
  return redactSensitive({ ...current, ...overrides });
}
