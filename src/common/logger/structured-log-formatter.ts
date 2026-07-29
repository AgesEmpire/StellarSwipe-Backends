/**
 * Produces structured JSON log records instead of plain text, adding
 * correlation metadata so entries can be traced and analyzed in
 * observability tools (e.g. filtering by requestId or correlating errors).
 */
export interface StructuredLogFields {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: string;
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

export function formatStructuredLog(fields: StructuredLogFields): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'stellarswipe-backend',
    ...fields,
  });
}
