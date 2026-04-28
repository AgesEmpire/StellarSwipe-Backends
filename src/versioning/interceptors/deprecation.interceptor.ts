import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { Response } from 'express';
import {
  DEPRECATED_KEY,
  DEPRECATION_METADATA_KEY,
  DeprecationOptions,
} from '../decorators/deprecated.decorator';

/**
 * DeprecationInterceptor
 *
 * Reads the @Deprecated() decorator metadata from the route handler or
 * controller class and injects the standard deprecation response headers:
 *
 *   Deprecation: true
 *   Sunset: <date>          (when sunsetDate is provided)
 *   Link: </api/v2>; rel="successor-version"  (when successorVersion is provided)
 *   X-Deprecation-Notice: <human-readable message>
 *
 * This works in tandem with VersionResolverMiddleware which handles
 * version-level deprecation. This interceptor handles endpoint-level
 * deprecation via the @Deprecated() decorator.
 */
@Injectable()
export class DeprecationInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const isDeprecated = this.reflector.getAllAndOverride<boolean>(
      DEPRECATED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isDeprecated) {
      const options = this.reflector.getAllAndOverride<DeprecationOptions>(
        DEPRECATION_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      );

      const res: Response = context.switchToHttp().getResponse();
      res.setHeader('Deprecation', 'true');

      if (options?.sunsetDate) {
        res.setHeader('Sunset', options.sunsetDate);
      }

      if (options?.successorVersion) {
        res.setHeader(
          'Link',
          `</api/v${options.successorVersion}>; rel="successor-version"`,
        );
      }

      const parts: string[] = ['This endpoint is deprecated.'];
      if (options?.reason) parts.push(options.reason);
      if (options?.sunsetDate) parts.push(`Sunset date: ${options.sunsetDate}.`);
      if (options?.successorVersion)
        parts.push(`Please migrate to v${options.successorVersion}.`);

      res.setHeader('X-Deprecation-Notice', parts.join(' '));
    }

    return next.handle();
  }
}
