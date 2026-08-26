import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { promises as dns } from 'dns';
import * as net from 'net';

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

/**
 * Issue #1029 — SSRF protection for user-supplied webhook URLs.
 *
 * Enforces:
 *  - Scheme: HTTPS only.
 *  - Port: 443 (explicit or implicit) only.
 *  - Hostname: blocked list (metadata endpoints by name).
 *  - IP addresses: all private, loopback, link-local, and cloud-metadata
 *    ranges are rejected, including post-DNS-resolution addresses to guard
 *    against DNS-rebinding.
 *
 * Redirects are controlled at the HTTP-client level (webhook-sender sets
 * `maxRedirects: 0`); this pipe handles the pre-registration validation layer.
 */
@Injectable()
export class SsrfValidationPipe implements PipeTransform {
  async transform(url: string): Promise<string> {
    if (url === undefined || url === null) {
      return url;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL format');
    }

    // 1. Scheme check
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
      throw new BadRequestException(
        `Webhook URL must use HTTPS (got "${parsed.protocol}")`,
      );
    }

    // 2. Port check — reject anything other than 443 / default
    const port = parsed.port; // empty string when implicit
    if (!ALLOWED_PORTS.has(port) && !ALLOWED_PORTS.has(Number(port))) {
      throw new BadRequestException(
        `Webhook URL must use the standard HTTPS port 443 (got port "${port}")`,
      );
    }

    // 3. Blocked-hostname check (metadata endpoints by DNS name)
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      throw new BadRequestException(
        `Webhook URL targets a blocked hostname: ${hostname}`,
      );
    }

    // 4. If hostname is a bare IP, validate it immediately — no DNS needed.
    if (net.isIP(hostname)) {
      if (isBlockedIp(hostname)) {
        throw new BadRequestException(
          'Webhook URLs must not target private, loopback, link-local, or cloud-metadata IP addresses',
        );
      }
      return url;
    }

    // 5. Resolve hostname and validate every returned address (DNS-rebinding guard).
    let addresses: string[];
    try {
      const results = await dns.lookup(hostname, { all: true });
      addresses = results.map((r) => r.address);
    } catch {
      throw new BadRequestException(
        `Cannot resolve webhook hostname: ${hostname}`,
      );
    }

    if (addresses.length === 0) {
      throw new BadRequestException(
        `No addresses resolved for webhook hostname: ${hostname}`,
      );
    }

    for (const ip of addresses) {
      if (isBlockedIp(ip)) {
        throw new BadRequestException(
          'Webhook URLs must not resolve to private, loopback, link-local, or cloud-metadata IP addresses',
        );
      }
    }

    return url;
  }
}
