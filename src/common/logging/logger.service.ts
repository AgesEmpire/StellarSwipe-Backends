import { Injectable, LoggerService as NestLoggerService, Scope } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Structured logging context contract.
 *
 * Every log entry emitted through {@link LoggerService} carries these fields so
 * that production diagnostics are machine-readable and searchable.
 */
export interface LogContext {
  /** Correlation id tying together all logs for a single request/job. */
  correlationId?: string;
  /** Actor that triggered the work (user id, service name, etc.). */
  actor?: string;
  /** Logical module emitting the log (e.g. "users", "billing"). */
  module?: string;
  /** Action being performed (e.g. "createUser", "processPayment"). */
  action?: string;
  /** Arbitrary additional structured fields. */
  [key: string]: unknown;
}

/** Actionable metadata attached to error logs. */
export interface ErrorMetadata {
  errorType?: string;
  errorMessage?: string;
  stack?: string;
  [key: string]: unknown;
}

/** Shape of a serialized structured log entry. */
export interface StructuredLogEntry extends LogContext {
  timestamp: string;
  level: 'debug' | 'verbose' | 'log' | 'warn' | 'error';
  message: string;
  error?: ErrorMetadata;
}

const REDACTED = '[REDACTED]';

/** Keys whose values must never be written to logs. */
const SENSITIVE_KEYS = [
  'password',
  'passwd',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'apikey',
  'authorization',
  'cookie',
  'creditCard',
  'cardNumber',
  'cvv',
  'ssn',
];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive.toLowerCase()));
}

/** Recursively redact sensitive values from a structured payload. */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value as object)) {
    return '[Circular]';
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  if (value instanceof Error) {
    return {
      errorType: value.name,
      errorMessage: value.message,
      stack: value.stack,
    };
  }

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redact(nested, seen);
  }
  return result;
}

/**
 * Request/job-scoped store that preserves correlation and actor context across
 * async boundaries without threading the context through every call site.
 */
const loggingContext = new AsyncLocalStorage<LogContext>();

/**
 * Run a callback with the given structured logging context bound to the current
 * async execution. Nested calls merge with the ambient context.
 */
export function runWithLogContext<T>(context: LogContext, callback: () => T): T {
  const merged = { ...loggingContext.getStore(), ...context };
  return loggingContext.run(merged, callback);
}

/** Read the ambient structured logging context, if any. */
export function getLogContext(): LogContext | undefined {
  return loggingContext.getStore();
}

/**
 * Structured logger implementing the NestJS {@link NestLoggerService} contract.
 *
 * Emits JSON lines with a consistent field set and redacts sensitive values.
 */
@Injectable({ scope: Scope.DEFAULT })
export class LoggerService implements NestLoggerService {
  constructor(private readonly defaultContext: LogContext = {}) {}

  /** Create a child logger that always includes the given context. */
  child(context: LogContext): LoggerService {
    return new LoggerService({ ...this.defaultContext, ...context });
  }

  log(message: unknown, context?: LogContext | string): void {
    this.write('log', message, context);
  }

  error(message: unknown, context?: LogContext | string, trace?: string): void {
    this.write('error', message, context, trace);
  }

  warn(message: unknown, context?: LogContext | string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: LogContext | string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: LogContext | string): void {
    this.write('verbose', message, context);
  }

  private write(
    level: StructuredLogEntry['level'],
    message: unknown,
    context?: LogContext | string,
    trace?: string,
  ): void {
    const ambient = loggingContext.getStore() ?? {};
    const explicit = typeof context === 'string' ? { module: context } : context ?? {};
    const merged: LogContext = { ...this.defaultContext, ...ambient, ...explicit };

    const { error, ...rest } = merged as LogContext & { error?: unknown };

    const entry: StructuredLogEntry = {
      ...(redact(rest) as LogContext),
      timestamp: new Date().toISOString(),
      level,
      message: typeof message === 'string' ? message : JSON.stringify(redact(message)),
    };

    if (level === 'error') {
      entry.error = this.buildErrorMetadata(error, message, trace);
    } else if (error !== undefined) {
      entry.error = this.buildErrorMetadata(error, undefined, trace);
    }

    const serialized = JSON.stringify(entry);
    if (level === 'error') {
      process.stderr.write(`${serialized}\n`);
    } else {
      process.stdout.write(`${serialized}\n`);
    }
  }

  private buildErrorMetadata(
    error: unknown,
    message: unknown,
    trace?: string,
  ): ErrorMetadata {
    if (error instanceof Error) {
      return {
        errorType: error.name,
        errorMessage: error.message,
        stack: error.stack ?? trace,
      };
    }

    if (error && typeof error === 'object') {
      const redacted = redact(error) as Record<string, unknown>;
      return {
        errorType: (redacted.errorType as string) ?? (redacted.name as string),
        errorMessage: (redacted.errorMessage as string) ?? (redacted.message as string),
        stack: (redacted.stack as string) ?? trace,
        ...redacted,
      };
    }

    if (message instanceof Error) {
      return {
        errorType: message.name,
        errorMessage: message.message,
        stack: message.stack ?? trace,
      };
    }

    return {
      errorType: typeof error === 'string' ? error : undefined,
      errorMessage: typeof message === 'string' ? message : undefined,
      stack: trace,
    };
  }
}
