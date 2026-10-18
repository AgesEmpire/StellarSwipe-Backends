import { promises as dns } from 'dns';
import * as net from 'net';

/**
 * Core SSRF validation rules, shared by:
 *  - SsrfValidationPipe (registration-time validation of a user-supplied
 *    webhook URL, surfaced as a BadRequestException via the Nest pipe).
 *  - sendWithValidatedRedirects (delivery-time revalidation of every
 *    redirect hop — see issue #1377 — surfaced as a plain Error since it
 *    runs outside of a request/response pipeline).
 *
 * Extracted out of the pipe so both call sites enforce byte-for-byte the
 * same scheme/port/hostname/IP rules instead of two copies drifting apart.
 */

/** Only these schemes are permitted for webhook delivery. */
const ALLOWED_SCHEMES = new Set(['https:']);

/** Only standard HTTPS port is permitted. Port 0 is always blocked. */
const ALLOWED_PORTS = new Set([443, '']); // '' means default (implicit 443)

/** Blocked hostname patterns — catches metadata endpoints by name. */
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
]);

/**
 * IP-range patterns that must never be webhook destinations.
 * Covers IPv4 loopback, RFC-1918 private, link-local, cloud metadata
 * (169.254.169.254), and IPv6 equivalents.
 */
const BLOCKED_IP_PATTERNS = [
  /^127\./, // IPv4 loopback (127.0.0.0/8)
  /^10\./, // RFC-1918 class A
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // RFC-1918 class B
  /^192\.168\./, // RFC-1918 class C
  /^169\.254\./, // link-local / cloud metadata
  /^0\.0\.0\.0$/, // unspecified
  /^::1$/, // IPv6 loopback
  /^::/, // IPv6 unspecified / loopback family
  /^f[cd][0-9a-f]{2}:/i, // IPv6 unique-local (fc00::/7)
  /^fe[89ab][0-9a-f]:/i, // IPv6 link-local (fe80::/10)
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // RFC-6598 shared address
];

function isBlockedIp(ip: string): boolean {
  return BLOCKED_IP_PATTERNS.some((p) => p.test(ip));
}

/** Thrown by {@link assertUrlIsSsrfSafe} — never a NestJS HttpException, since
 * it's also used outside of a request/response pipeline (redirect hops). */
export class SsrfBlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedUrlError';
  }
}

/**
 * Validates that `url` is an acceptable outbound webhook destination:
 *  - Scheme: HTTPS only.
 *  - Port: 443 (explicit or implicit) only.
 *  - Hostname: not on the blocked list (metadata endpoints by name).
 *  - IP addresses: all private, loopback, link-local, and cloud-metadata
 *    ranges are rejected, including post-DNS-resolution addresses to guard
 *    against DNS-rebinding.
 *
 * Throws {@link SsrfBlockedUrlError} (never returns a value) when the URL
 * is rejected.
 */
export async function assertUrlIsSsrfSafe(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfBlockedUrlError('Invalid URL format');
  }

  // 1. Scheme check
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new SsrfBlockedUrlError(
      `Webhook URL must use HTTPS (got "${parsed.protocol}")`,
    );
  }

  // 2. Port check — reject anything other than 443 / default
  const port = parsed.port; // empty string when implicit
  if (!ALLOWED_PORTS.has(port) && !ALLOWED_PORTS.has(Number(port))) {
    throw new SsrfBlockedUrlError(
      `Webhook URL must use the standard HTTPS port 443 (got port "${port}")`,
    );
  }

  // 3. Blocked-hostname check (metadata endpoints by DNS name)
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SsrfBlockedUrlError(
      `Webhook URL targets a blocked hostname: ${hostname}`,
    );
  }

  // 4. If hostname is a bare IP, validate it immediately — no DNS needed.
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new SsrfBlockedUrlError(
        'Webhook URLs must not target private, loopback, link-local, or cloud-metadata IP addresses',
      );
    }
    return;
  }

  // 5. Resolve hostname and validate every returned address (DNS-rebinding guard).
  let addresses: string[];
  try {
    const results = await dns.lookup(hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    throw new SsrfBlockedUrlError(
      `Cannot resolve webhook hostname: ${hostname}`,
    );
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedUrlError(
      `No addresses resolved for webhook hostname: ${hostname}`,
    );
  }

  for (const ip of addresses) {
    if (isBlockedIp(ip)) {
      throw new SsrfBlockedUrlError(
        'Webhook URLs must not resolve to private, loopback, link-local, or cloud-metadata IP addresses',
      );
    }
  }
}
