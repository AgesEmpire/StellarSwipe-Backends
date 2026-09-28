import { Injectable, CanActivate, ExecutionContext, GoneException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VersionManagerService } from '../version-manager.service';
import { API_VERSION_KEY } from '../decorators/api-version.decorator';

/**
 * VersionCompatibilityGuard — rejects requests to sunset/unsupported versions
 * and attaches deprecation warnings for deprecated ones.
 *
 * Apply globally or per-controller. Works alongside VersionResolverMiddleware
 * which sets req.apiVersion from the URL/header.
 */
@Injectable()
export class VersionCompatibilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly versionManager: VersionManagerService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    // Prefer handler/class-level @ApiVersion() over the middleware-resolved version
    const decoratorVersion = this.reflector.getAllAndOverride<string>(API_VERSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const version: string = decoratorVersion ?? req['apiVersion'] ?? this.versionManager.getDefaultVersion();

    if (!this.versionManager.isSupported(version)) {
      throw new GoneException(
        `API version ${version} has been sunset. Please upgrade to v${this.versionManager.getDefaultVersion()}.`,
      );
    }

    if (this.versionManager.isDeprecated(version)) {
      const meta = this.versionManager.getVersionMetadata(version);
      res.setHeader('Deprecation', 'true');
      if (meta?.sunsetDate) res.setHeader('Sunset', meta.sunsetDate);
      if (meta?.successorVersion) {
        res.setHeader('Link', `</api/v${meta.successorVersion}>; rel="successor-version"`);
      }
    }

    return true;
  }
}
