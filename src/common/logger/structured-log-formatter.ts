import { redactSensitiveFields } from './log-redaction';

export type LogSeverity = 'debug' | 'info' | 'warn' | 'error' | 'verbose';

/**
 * Produces structured JSON log records instead of plain text, adding
 * standard service, environment, correlation, and event metadata.
 */
export interface StructuredLogFields {
  level: LogSeverity;
  message: string;
  eventName?: string;
  context?: string;
  service?: string;
  environment?: string;
  correlationId?: string;
  traceId?: string;
  requestId?: string;
  userId?: string;
  tenantId?: string;
  error?: Record<string, unknown>;
  [key: string]: unknown;
}

export function formatStructuredLog(fields: StructuredLogFields): string {
  const sanitized = redactSensitiveFields(fields) as StructuredLogFields;
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    service: sanitized.service || process.env.SERVICE_NAME || 'stellarswipe-backend',
    environment: sanitized.environment || process.env.NODE_ENV || 'development',
    ...sanitized,
  });
}
