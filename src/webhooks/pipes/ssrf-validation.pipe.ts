import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { promises as dns } from 'dns';
import * as net from 'net';

const BLOCKED_PATTERNS = [
  // IPv4 loopback
  /^127\./,
  // IPv4 private class A
  /^10\./,
  // IPv4 private class B
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  // IPv4 private class C
  /^192\.168\./,
  // IPv4 link-local
  /^169\.254\./,
  // IPv6 loopback
  /^::1$/,
  // IPv6 unique-local
  /^f[cd][0-9a-f]{2}:/i,
  // IPv6 link-local
  /^fe[89ab][0-9a-f]:/i,
  // Unspecified
  /^0\.0\.0\.0$/,
  /^::$/,
];

function isBlockedIp(ip: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(ip));
}

@Injectable()
export class SsrfValidationPipe implements PipeTransform {
  async transform(url: string): Promise<string> {
    if (url === undefined || url === null) {
      return url;
    }

    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      throw new BadRequestException('Invalid URL format');
    }

    if (net.isIP(hostname)) {
      if (isBlockedIp(hostname)) {
        throw new BadRequestException(
          'Webhook URLs must not target private, loopback, or link-local IP addresses',
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
          'Webhook URLs must not resolve to private, loopback, or link-local IP addresses',
        );
      }
    }

    return url;
  }
}
