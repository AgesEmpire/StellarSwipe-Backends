import * as crypto from 'crypto';

export type HmacAlgorithm = 'sha256' | 'sha512';

export interface ParsedSignatureHeader {
  /** Unix seconds embedded in a `t=<ts>,v1=<hex>` style header. Absent for raw `sha256=<hex>` headers. */
  timestamp?: number;
  signature: string;
}

export interface RotatingSignatureResult {
  valid: boolean;
  /** Index into the secrets array that produced a match, -1 if none matched. */
  matchedSecretIndex: number;
  /** Timestamp parsed from the header, when present, regardless of match outcome. */
  timestamp?: number;
}

const HEX_PATTERN = /^[a-f0-9]+$/i;

/** True when `value` is a well-formed, even-length hex string (a valid HMAC digest shape). */
export function isHexSignature(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length % 2 === 0 && HEX_PATTERN.test(value);
}

/**
 * Parses a signature header into its component parts. Two shapes are used
 * across our integrations:
 *
 *   - Raw:         "sha256=<hex>" | "sha512=<hex>" | "<hex>"
 *     (M-Pesa, Paystack, Onfido, our own outbound webhooks)
 *
 *   - Timestamped: "t=<unixSeconds>,v1=<hex>"
 *     (Persona, and our own inbound `x-stellarswipe-signature` when timestamped)
 *
 * Returns `null` when the header is missing or doesn't match either shape —
 * callers treat that as a malformed request and reject it before doing any
 * further work.
 */
export function parseSignatureHeader(signatureHeader: string | undefined): ParsedSignatureHeader | null {
  if (!signatureHeader || typeof signatureHeader !== 'string') return null;
  const header = signatureHeader.trim();
  if (!header) return null;

  if (/^t=/i.test(header)) {
    const parts: Record<string, string> = {};
    for (const part of header.split(',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      parts[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
    const timestamp = Number(parts['t']);
    const signature = parts['v1'];
    if (!signature || !Number.isFinite(timestamp)) return null;
    return { timestamp, signature };
  }

  const signature = header.replace(/^sha(256|512)=/i, '').trim();
  if (!signature) return null;
  return { signature };
}

function computeHmac(message: string, secret: string, algorithm: HmacAlgorithm): string {
  return crypto.createHmac(algorithm, secret).update(message).digest('hex');
}

function timingSafeHexEqual(expectedHex: string, receivedHex: string): boolean {
  if (!isHexSignature(receivedHex)) return false;
  const expectedBuffer = Buffer.from(expectedHex, 'hex');
  const receivedBuffer = Buffer.from(receivedHex, 'hex');
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Verifies an HMAC signature against an ordered list of candidate secrets.
 *
 * This is the core primitive that makes zero-downtime secret rotation
 * possible: pass `[currentSecret, previousSecret]` and a signature produced
 * with either one will verify. Callers should treat a match against any
 * index other than `0` as a signal that the sender hasn't picked up the
 * newest secret yet.
 *
 * For timestamped headers (`t=<ts>,v1=<hex>`), the signed message is
 * `${timestamp}.${rawBody}` per the Stripe/Persona convention; for raw
 * headers, the signed message is the raw body itself.
 */
export function verifyRotatingHmacSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secrets: string[],
  algorithm: HmacAlgorithm = 'sha256',
): RotatingSignatureResult {
  const parsed = parseSignatureHeader(signatureHeader);
  if (!rawBody || !parsed || secrets.length === 0) {
    return { valid: false, matchedSecretIndex: -1, timestamp: parsed?.timestamp };
  }

  const message = parsed.timestamp !== undefined ? `${parsed.timestamp}.${rawBody}` : rawBody;

  for (let i = 0; i < secrets.length; i++) {
    const secret = secrets[i];
    if (!secret) continue;
    const expected = computeHmac(message, secret, algorithm);
    if (timingSafeHexEqual(expected, parsed.signature)) {
      return { valid: true, matchedSecretIndex: i, timestamp: parsed.timestamp };
    }
  }

  return { valid: false, matchedSecretIndex: -1, timestamp: parsed.timestamp };
}

/** Single-secret convenience wrapper, kept for backward compatibility. */
export function verifyHmacSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  algorithm: HmacAlgorithm = 'sha256',
): boolean {
  if (!rawBody || !signatureHeader || !secret) return false;
  return verifyRotatingHmacSignature(rawBody, signatureHeader, [secret], algorithm).valid;
}

export const verifyHmacSHA256 = (
  rawBody: string,
  signatureHeader: string,
  secret: string,
): boolean => verifyHmacSignature(rawBody, signatureHeader, secret, 'sha256');
