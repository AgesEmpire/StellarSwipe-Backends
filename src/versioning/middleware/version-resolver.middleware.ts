import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { VersionManagerService } from '../version-manager.service';

@Injectable()
export class VersionResolverMiddleware implements NestMiddleware {
  constructor(private readonly versionManager: VersionManagerService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const urlVersion = req.path.match(/\/api\/v(\d+)\//)?.[1];
    const headerVersion = req.headers['api-version'] as string;
    
    const requestedVersion = urlVersion || headerVersion || this.versionManager.getDefaultVersion();

    if (!this.versionManager.isSupported(requestedVersion)) {
      throw new NotFoundException(`API Version ${requestedVersion} is no longer supported or invalid.`);
    }

    // Version negotiation: surface the resolved version and the full set of
    // currently supported versions on every response (not just deprecated
    // ones) so clients can negotiate/introspect without guessing from docs.
    res.setHeader('X-API-Version', requestedVersion);
    res.setHeader('X-API-Supported-Versions', this.versionManager.getSupportedVersions().join(', '));

    const metadata = this.versionManager.getVersionMetadata(requestedVersion);
    if (metadata) {
      if (this.versionManager.isDeprecated(requestedVersion)) {
        res.setHeader('Deprecation', 'true');
        if (metadata.sunsetDate) {
          res.setHeader('Sunset', metadata.sunsetDate);
        }
        if (metadata.successorVersion) {
          res.setHeader('Link', `</api/v${metadata.successorVersion}>; rel="successor-version"`);
        }
      }
    }

    req['apiVersion'] = requestedVersion;
    next();
  }
}
