/**
 * Log redaction utility.
 *
 * Sensitive-field names are split into two categories:
 *
 *  FULL_REDACT  – secrets/tokens that must never appear in logs.
 *                 Replaced with "[REDACTED]".
 *
 *  PARTIAL_MASK – PII where the last 4 chars help with debugging
 *                 (e.g. email suffix, wallet tail).
 *                 Replaced with "****<last4>" for strings longer than 4 chars,
 *                 otherwise fully redacted.
 *
 * The default field lists can be extended at runtime via environment variables:
 *   REDACT_FULL_FIELDS   – comma-separated extra field-name substrings for full redaction
 *   REDACT_PARTIAL_FIELDS – comma-separated extra field-name substrings for partial masking
 */

const DEFAULT_FULL_REDACT_FIELDS = [
  'password',
  'token',
  'apikey',
  'secretkey',
  'privatekey',
  'authorization',
  'secret',
  'accesstoken',
  'refreshtoken',
  'otp',
  'pin',
  'cvv',
  'ssn',
];

const DEFAULT_PARTIAL_MASK_FIELDS = [
  'email',
  'walletaddress',
  'address',
  'phone',
  'cardnumber',
  'accountnumber',
  'iban',
];

function parseEnvList(envVar: string | undefined): string[] {
  if (!envVar) return [];
  return envVar
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function buildFieldSets(): {
  fullRedact: string[];
  partialMask: string[];
} {
  const fullRedact = [
    ...DEFAULT_FULL_REDACT_FIELDS,
    ...parseEnvList(process.env.REDACT_FULL_FIELDS),
  ];
  const partialMask = [
    ...DEFAULT_PARTIAL_MASK_FIELDS,
    ...parseEnvList(process.env.REDACT_PARTIAL_FIELDS),
  ];
  return { fullRedact, partialMask };
}

function matchesAny(key: string, patterns: string[]): boolean {
  const lower = key.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

function partialMask(value: string): string {
  if (value.length <= 4) return '[REDACTED]';
  return `****${value.slice(-4)}`;
}

/**
 * Recursively walks `obj` and replaces values whose key matches a sensitive
 * pattern with a redacted or partially-masked version.
 *
 * – Arrays are walked element by element.
 * – Circular references are replaced with "[Circular]".
 * – Non-object primitives are returned as-is.
 */
export function redactSensitiveFields(obj: unknown): unknown {
  const { fullRedact, partialMask: partialFields } = buildFieldSets();
  const seen = new WeakSet<object>();

  function walk(item: unknown): unknown {
    if (item === null || typeof item !== 'object') return item;

    if (seen.has(item as object)) return '[Circular]';
    seen.add(item as object);

    if (Array.isArray(item)) {
      return item.map((el) => walk(el));
    }

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(item as Record<string, unknown>)) {
      if (matchesAny(key, fullRedact)) {
        result[key] = '[REDACTED]';
      } else if (matchesAny(key, partialFields)) {
        result[key] = typeof val === 'string' ? partialMask(val) : '[REDACTED]';
      } else {
        result[key] = walk(val);
      }
    }
    return result;
  }

  return walk(obj);
}
