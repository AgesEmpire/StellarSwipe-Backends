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
import { ADMIN_IP_GUARD_KEY, AdminIpGuardConfig } from '../decorators/admin-ip-guard.decorator';

@Injectable()
export class AdminIpAllowlistGuard implements CanActivate {
  private readonly logger = new Logger(AdminIpAllowlistGuard.name);
  private readonly allowedIpRanges: string[];
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

  private loadAllowedIpRanges(): string[] {
    if (!this.configService) {
      return this.getDefaultIpRanges();
    }

    const envVar = this.configService.get<string>('ADMIN_IP_ALLOWLIST');
    if (envVar) {
      return envVar.split(',').map(ip => ip.trim());
    }

    return this.getDefaultIpRanges();
  }

  private getDefaultIpRanges(): string[] {
    // Default: localhost and common internal IP ranges
    return [
      '127.0.0.1',
      '::1',
      '10.0.0.0/8',       // Private network
      '172.16.0.0/12',    // Private network
      '192.168.0.0/16',   // Private network
    ];
  }

  private isIpAllowed(clientIp: string): boolean {
    return this.allowedIpRanges.some(range => {
      // Exact match
      if (clientIp === range) {
        return true;
      }

      // CIDR range check (simplified: handles /8, /12, /16, /24)
      if (range.includes('/')) {
        return this.isIpInCidrRange(clientIp, range);
      }

      return false;
    });
  }

  private isIpInCidrRange(ip: string, cidrRange: string): boolean {
    // Skip IPv6 complex CIDR checks; handle IPv4 only for simplicity
    if (ip.includes(':')) {
      return false; // TODO: implement IPv6 CIDR support if needed
    }

    const [rangeIp, maskBits] = cidrRange.split('/');
    const mask = parseInt(maskBits, 10);

    const ipParts = ip.split('.').map(Number);
    const rangeParts = rangeIp.split('.').map(Number);

    if (ipParts.length !== 4 || rangeParts.length !== 4) {
      return false;
    }

    // Convert to 32-bit integers for bitwise comparison
    const ipInt = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
    const rangeInt =
      (rangeParts[0] << 24) |
      (rangeParts[1] << 16) |
      (rangeParts[2] << 8) |
      rangeParts[3];

    // Create bitmask
    const maskInt = ~((1 << (32 - mask)) - 1);

    return (ipInt & maskInt) === (rangeInt & maskInt);
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
