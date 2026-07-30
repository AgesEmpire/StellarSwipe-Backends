/**
 * Free-text PII redaction.
 *
 * `redactSensitiveFields` (log-redaction.ts) only scrubs values keyed by a
 * sensitive field name. That misses PII embedded in freeform strings —
 * e.g. an alert `message` that interpolates a wallet address or email
 * directly into a sentence. This module regex-scans string content itself,
 * independent of the surrounding key name.
 *
 * Used anywhere a payload leaves the process boundary and can't rely on
 * object-shape redaction alone: alert webhooks/Slack messages, exception
 * summaries forwarded to third parties, etc.
 */

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Stellar/Soroban public keys (G...) and secret keys (S...): 56-char base32.
const STELLAR_KEY_PATTERN = /\b[GS][A-Z2-7]{55}\b/g;

// Credit-card-like sequences: 13-19 digits, optionally grouped by spaces/dashes.
const CARD_NUMBER_PATTERN = /\b(?:\d[ -]?){13,19}\b/g;

// E.164-ish phone numbers.
const PHONE_PATTERN = /\+?\d{1,3}[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;

interface TextRedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

const RULES: TextRedactionRule[] = [
  { name: 'email', pattern: EMAIL_PATTERN, replacement: '[REDACTED_EMAIL]' },
  { name: 'stellarKey', pattern: STELLAR_KEY_PATTERN, replacement: '[REDACTED_STELLAR_KEY]' },
  { name: 'cardNumber', pattern: CARD_NUMBER_PATTERN, replacement: '[REDACTED_CARD_NUMBER]' },
  { name: 'phone', pattern: PHONE_PATTERN, replacement: '[REDACTED_PHONE]' },
];

/**
 * Scrubs PII patterns out of a single string. Non-string input is returned
 * unchanged so callers can pass this through indiscriminately.
 */
export function redactSensitiveText(value: string): string {
  if (typeof value !== 'string' || value.length === 0) return value;

  let result = value;
  for (const rule of RULES) {
    // Reset lastIndex since these regexes are declared with the global flag
    // and reused across calls.
    rule.pattern.lastIndex = 0;
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}

/**
 * Recursively applies `redactSensitiveText` to every string leaf in an
 * arbitrary value (objects, arrays, primitives). Unlike
 * `redactSensitiveFields`, this does not care about key names — it inspects
 * the string content itself, so it catches PII regardless of which field
 * it was placed under.
 */
export function deepRedactText<T>(input: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof input === 'string') {
    return redactSensitiveText(input) as unknown as T;
  }

  if (input === null || typeof input !== 'object') {
    return input;
  }

  if (seen.has(input as object)) {
    return '[Circular]' as unknown as T;
  }
  seen.add(input as object);

  if (Array.isArray(input)) {
    return input.map((el) => deepRedactText(el, seen)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    result[key] = deepRedactText(val, seen);
  }
  return result as T;
}
