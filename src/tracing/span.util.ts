import { context, propagation, trace, SpanStatusCode, Attributes } from '@opentelemetry/api';

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|seed|mnemonic|signature|ssn|email|phone|card|cvv/i;
const MAX_ATTR_LENGTH = 256;
const TRACER_NAME = 'stellarswipe-backend';

/** Drop sensitive keys and truncate long values before they reach span attributes. */
export function sanitizeAttributes(attrs: Record<string, unknown> = {}): Attributes {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (SENSITIVE_KEY.test(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else {
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      out[key] = str.length > MAX_ATTR_LENGTH ? `${str.slice(0, MAX_ATTR_LENGTH)}…` : str;
    }
  }
  return out;
}

/** Strip query strings (may carry tokens) from URLs recorded on spans. */
export function safeUrl(url: string): string {
  const idx = url.indexOf('?');
  return idx === -1 ? url : url.slice(0, idx);
}

/**
 * Run `fn` inside an active span. Tracing failures never break the wrapped
 * call: if the API is a no-op or the exporter is down, `fn` still runs.
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T> | T,
  attributes: Record<string, unknown> = {},
): Promise<T> {
  let span;
  try {
    span = trace.getTracer(TRACER_NAME).startSpan(name, { attributes: sanitizeAttributes(attributes) });
  } catch {
    return fn();
  }
  const ctx = trace.setSpan(context.active(), span);
  try {
    const result = await context.with(ctx, fn);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.name ?? 'Error' });
    throw err;
  } finally {
    span.end();
  }
}

/** Inject W3C trace context into outbound HTTP headers or job payloads. */
export function injectTraceContext(carrier: Record<string, string> = {}): Record<string, string> {
  try {
    propagation.inject(context.active(), carrier);
  } catch {
    /* propagation is best-effort */
  }
  return carrier;
}

/** Run `fn` as a child of the trace context carried by a job payload / inbound headers. */
export function withExtractedContext<T>(
  carrier: Record<string, unknown> | undefined,
  name: string,
  fn: () => Promise<T> | T,
  attributes: Record<string, unknown> = {},
): Promise<T> {
  let parent = context.active();
  try {
    if (carrier) parent = propagation.extract(parent, carrier);
  } catch {
    /* ignore malformed carriers */
  }
  return context.with(parent, () => withSpan(name, fn, attributes));
}
