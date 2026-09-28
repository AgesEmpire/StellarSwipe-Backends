import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  MINIMUM_SDK_VERSION_KEY,
  MinimumSdkVersionConfig,
  MissingHeaderBehavior,
} from '../decorators/minimum-sdk-version.decorator';

@Injectable()
export class MinimumSdkVersionGuard implements CanActivate {
  private readonly logger = new Logger(MinimumSdkVersionGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const config = this.reflector.get<MinimumSdkVersionConfig>(
      MINIMUM_SDK_VERSION_KEY,
      context.getHandler(),
    );

    // If no config, allow the request
    if (!config) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const providedVersion = request.headers[config.headerName.toLowerCase()];

    // Handle missing header
    if (!providedVersion) {
      this.handleMissingHeader(config, request);
      if (config.missingHeaderBehavior === MissingHeaderBehavior.REJECT) {
        throw new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'Missing SDK Version Header',
          message: `Required header '${config.headerName}' is missing`,
          guidance: `Please include the '${config.headerName}' header in your request with your client SDK version. Minimum required version: ${config.version}`,
        });
      }
      return true;
    }

    // Validate version format and compare
    if (!this.isValidVersionFormat(providedVersion)) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Invalid SDK Version Format',
        message: `Header '${config.headerName}' has invalid format: ${providedVersion}`,
        guidance: `Please use semantic versioning (e.g., "1.2.3") for your SDK version.`,
      });
    }

    if (this.compareVersions(providedVersion, config.version) < 0) {
      this.logOutdatedVersion(providedVersion, config.version, request);
      throw new HttpException(
        {
          statusCode: HttpStatus.UPGRADE_REQUIRED,
          error: 'SDK Version Outdated',
          message: `Your SDK version ${providedVersion} is below the minimum required version ${config.version}`,
          currentVersion: providedVersion,
          minimumVersion: config.version,
          guidance: `Please update your client SDK to version ${config.version} or higher. Check your package manager or download the latest release from our repository.`,
        },
        426, // HTTP 426 Upgrade Required
      );
    }

    response.setHeader('X-Validated-SDK-Version', providedVersion);
    return true;
  }

  private isValidVersionFormat(version: string): boolean {
    const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?(\+[a-zA-Z0-9]+)?$/;
    return semverRegex.test(version.trim());
  }

  /**
   * Compare two semantic versions.
   * Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
   */
  private compareVersions(v1: string, v2: string): number {
    const normalize = (v: string) => {
      const trimmed = v.trim();
      const baseParts = trimmed.split(/[-+]/)[0].split('.').map(Number);
      return baseParts;
    };

    const parts1 = normalize(v1);
    const parts2 = normalize(v2);
    const maxLen = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLen; i++) {
      const p1 = parts1[i] ?? 0;
      const p2 = parts2[i] ?? 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }

    return 0;
  }

  private handleMissingHeader(config: MinimumSdkVersionConfig, request: any): void {
    const clientIp = this.getClientIP(request);
    this.logger.warn(
      `Missing SDK version header from client at ${clientIp}`,
      {
        type: 'missing_sdk_version_header',
        clientIp,
        endpoint: request.url,
        behavior: config.missingHeaderBehavior,
        timestamp: new Date().toISOString(),
      },
    );
  }

  private logOutdatedVersion(
    providedVersion: string,
    requiredVersion: string,
    request: any,
  ): void {
    const clientIp = this.getClientIP(request);
    this.logger.warn(
      `Outdated SDK version detected: ${providedVersion} (minimum: ${requiredVersion}) from ${clientIp}`,
      {
        type: 'outdated_sdk_version',
        clientIp,
        providedVersion,
        requiredVersion,
        endpoint: request.url,
        userAgent: request.headers['user-agent'],
        timestamp: new Date().toISOString(),
      },
    );
  }

  private getClientIP(request: any): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return request.headers['x-real-ip'] || request.socket?.remoteAddress || 'unknown';
  }
}
