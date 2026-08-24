import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { promises as dns } from 'dns';
import * as net from 'net';

/**
 * SSRF protection for user-configured webhook destinations (issue #1029).
 *
 * Blocks:
 * - Non-https schemes in production (http allowed only outside production for local testing)
 * - Non-standard ports (only 443, 80, or default)
 * - Loopback, private, link-local, and cloud-metadata ranges (IPv4 + IPv6)
 * - Hostnames that resolve to any blocked address (DNS rebinding / internal names)
 */
const BLOCKED_PATTERNS = [
  // IPv4 loopback
  /^127\./,
  // IPv4 private class A
  /^10\./,
  // IPv4 private class B
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  // IPv4 private class C
  /^192\.168\./,
  // IPv4 link-local + cloud metadata (AWS/GCP/Azure often use 169.254.169.254)
  /^169\.254\./,
  // Carrier-grade NAT
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./,
  // IPv6 loopback
  /^::1$/,
  // IPv6 unique-local (fc00::/7)
  /^f[cd][0-9a-f]{2}:/i,
  // IPv6 link-local (fe80::/10)
  /^fe[89ab][0-9a-f]:/i,
  // Unspecified
  /^0\.0\.0\.0$/,
  /^::$/,
];

const ALLOWED_PORTS = new Set([80, 443]);

function isBlockedIp(ip: string): boolean {
  // Normalize IPv6 mapped IPv4 (::ffff:x.x.x.x)
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const candidate = mapped ? mapped[1] : ip;
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(candidate));
}

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

    // Scheme restriction
    const scheme = parsed.protocol.replace(':', '').toLowerCase();
    const isProd = process.env.NODE_ENV === 'production';
    if (scheme !== 'https' && !(scheme === 'http' && !isProd)) {
      throw new BadRequestException(
        isProd
          ? 'Webhook URLs must use the https scheme'
          : 'Webhook URLs must use http or https',
      );
    }

    // Port restriction (empty port means default for the scheme)
    if (parsed.port) {
      const port = Number(parsed.port);
      if (!ALLOWED_PORTS.has(port)) {
        throw new BadRequestException(
          'Webhook URLs may only use ports 80 or 443',
        );
      }
    }

    const hostname = parsed.hostname;

    // Block obvious hostnames without waiting for DNS
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname === 'metadata.google.internal'
    ) {
      throw new BadRequestException(
        'Webhook URLs must not target private, loopback, or metadata hosts',
      );
    }

    if (net.isIP(hostname)) {
      if (isBlockedIp(hostname)) {
        throw new BadRequestException(
          'Webhook URLs must not target private, loopback, link-local, or metadata IP addresses',
        );
      }
      return url;
    }

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
          'Webhook URLs must not resolve to private, loopback, link-local, or metadata IP addresses',
        );
      }
    }

    return url;
  }
}
