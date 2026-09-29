import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { isIPv4, isIPv6 } from 'net';
import { ADMIN_IP_GUARD_KEY, AdminIpGuardConfig } from '../decorators/admin-ip-guard.decorator';

interface ParsedIpAddress {
  version: 4 | 6;
  value: bigint;
}

export interface ParsedIpRange extends ParsedIpAddress {
  prefix: number;
}

const IPV4_MAPPED_PREFIX = BigInt('0xffff00000000');

function ipv4ToBigInt(ip: string): bigint {
  return ip
    .split('.')
    .reduce((acc, part) => (acc << BigInt(8)) + BigInt(Number(part)), BigInt(0));
}

function ipv6ToBigInt(ip: string): bigint {
  let address = ip;
  // Expand an embedded IPv4 tail (e.g. ::ffff:10.0.0.1) into two hextets.
  const lastColon = address.lastIndexOf(':');
  const tail = address.slice(lastColon + 1);
  if (isIPv4(tail)) {
    const v4 = ipv4ToBigInt(tail);
    address = `${address.slice(0, lastColon + 1)}${(v4 >> BigInt(16)).toString(16)}:${(v4 & BigInt(0xffff)).toString(16)}`;
  }

  const [head, rest] = address.split('::');
  const headParts = head ? head.split(':') : [];
  const restParts = rest !== undefined && rest !== '' ? rest.split(':') : [];
  const fill = rest !== undefined ? 8 - headParts.length - restParts.length : 0;
  const hextets = [...headParts, ...Array(fill).fill('0'), ...restParts];

  return hextets.reduce((acc, h) => (acc << BigInt(16)) + BigInt(parseInt(h, 16)), BigInt(0));
}

/** Parses an IPv4/IPv6 address, normalising IPv4-mapped IPv6 to IPv4. */
export function parseIpAddress(raw: string): ParsedIpAddress | null {
  const ip = raw.split('%')[0]; // strip IPv6 zone id
  if (isIPv4(ip)) {
    return { version: 4, value: ipv4ToBigInt(ip) };
  }
  if (isIPv6(ip)) {
    const value = ipv6ToBigInt(ip);
    if (value >> BigInt(32) === IPV4_MAPPED_PREFIX >> BigInt(32)) {
      return { version: 4, value: value & BigInt(0xffffffff) };
    }
    return { version: 6, value };
  }
  return null;
}

/** Parses an address or CIDR range; returns a reason when the entry is malformed. */
export function parseIpRange(raw: string): ParsedIpRange | { reason: string } {
  const parts = raw.split('/');
  if (parts.length > 2) {
    return { reason: 'multiple prefix separators' };
  }
  const ip = parseIpAddress(parts[0]);
  if (!ip) {
    return { reason: 'invalid IP address' };
  }
  const maxBits = ip.version === 4 ? 32 : 128;
  if (parts.length === 1) {
    return { ...ip, prefix: maxBits };
  }
  if (!/^\d{1,3}$/.test(parts[1])) {
    return { reason: 'invalid prefix length' };
  }
  let prefix = Number(parts[1]);
  // IPv4-mapped IPv6 ranges are normalised to IPv4, so shift the prefix too.
  if (ip.version === 4 && isIPv6(parts[0].split('%')[0])) {
    prefix -= 96;
  }
  if (prefix < 0 || prefix > maxBits) {
    return { reason: `prefix length out of range for IPv${ip.version}` };
  }
  return { ...ip, prefix };
}

export function isIpInRange(ip: ParsedIpAddress, range: ParsedIpRange): boolean {
  if (ip.version !== range.version) {
    return false;
  }
  const bits = BigInt(ip.version === 4 ? 32 : 128);
  const hostBits = bits - BigInt(range.prefix);
  return ip.value >> hostBits === range.value >> hostBits;
}

@Injectable()
export class AdminIpAllowlistGuard implements CanActivate {
  private readonly logger = new Logger(AdminIpAllowlistGuard.name);
  private readonly allowedIpRanges: ParsedIpRange[];
  private readonly environment: string;

  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly configService?: ConfigService,
  ) {
    this.environment = this.configService?.get<string>('NODE_ENV') ?? 'development';
    this.allowedIpRanges = this.loadAllowedIpRanges();
  }

  canActivate(context: ExecutionContext): boolean {
    const config = this.reflector.get<AdminIpGuardConfig>(
      ADMIN_IP_GUARD_KEY,
      context.getHandler(),
    );

    // If no config or guard is disabled, allow the request
    if (!config || config.enabled === false) {
      return true;
    }

    // In development, allow all IPs
    if (this.environment === 'development') {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const clientIp = this.getClientIP(request);

    // Check if IP is allowed
    if (!this.isIpAllowed(clientIp)) {
      this.logRejectedAttempt(request, clientIp);
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Admin Access Restricted',
        message: 'Access to admin endpoints is restricted to internal IP addresses',
        clientIp,
        guidance: 'This endpoint is only accessible from whitelisted internal IP ranges.',
      });
    }

    this.logAllowedAttempt(request, clientIp);
    return true;
  }

  private loadAllowedIpRanges(): ParsedIpRange[] {
    const envVar = this.configService?.get<string>('ADMIN_IP_ALLOWLIST');
    const rawRanges = envVar
      ? envVar.split(',').map(ip => ip.trim()).filter(Boolean)
      : this.getDefaultIpRanges();

    const parsed: ParsedIpRange[] = [];
    for (const raw of rawRanges) {
      const result = parseIpRange(raw);
      if ('reason' in result) {
        // Fail closed: malformed entries never match, and are logged for audit.
        this.logger.warn(`Ignoring malformed admin IP allowlist entry: ${raw}`, {
          type: 'admin_ip_allowlist_invalid_range',
          range: raw,
          reason: result.reason,
        });
        continue;
      }
      parsed.push(result);
    }
    return parsed;
  }

  private getDefaultIpRanges(): string[] {
    // Default: localhost and common internal IP ranges
    return [
      '127.0.0.1',
      '::1',
      '10.0.0.0/8',       // Private network
      '172.16.0.0/12',    // Private network
      '192.168.0.0/16',   // Private network
      'fc00::/7',         // IPv6 unique local addresses
    ];
  }

  private isIpAllowed(clientIp: string): boolean {
    const ip = parseIpAddress(clientIp);
    if (!ip) {
      return false;
    }
    return this.allowedIpRanges.some(range => isIpInRange(ip, range));
  }

  private getClientIP(request: any): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return request.headers['x-real-ip'] || request.socket?.remoteAddress || 'unknown';
  }

  private logRejectedAttempt(request: any, clientIp: string): void {
    this.logger.error(
      `Admin access attempt rejected from unauthorized IP: ${clientIp}`,
      {
        type: 'admin_access_rejected',
        clientIp,
        endpoint: request.url,
        method: request.method,
        userAgent: request.headers['user-agent'],
        timestamp: new Date().toISOString(),
      },
    );

    // TODO: Integrate with alerting system (e.g., send to monitoring/security dashboard)
    // Example: this.alertingService.alert({ severity: 'high', message: '...' })
  }

  private logAllowedAttempt(request: any, clientIp: string): void {
    this.logger.debug(
      `Admin access granted for whitelisted IP: ${clientIp}`,
      {
        type: 'admin_access_allowed',
        clientIp,
        endpoint: request.url,
        timestamp: new Date().toISOString(),
      },
    );
  }
}
