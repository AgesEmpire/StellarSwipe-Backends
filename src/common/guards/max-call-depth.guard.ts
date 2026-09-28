import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MAX_CALL_DEPTH_KEY, MaxCallDepthConfig } from '../decorators/max-call-depth.decorator';

@Injectable()
export class MaxCallDepthGuard implements CanActivate {
  private readonly logger = new Logger(MaxCallDepthGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const config = this.reflector.get<MaxCallDepthConfig>(
      MAX_CALL_DEPTH_KEY,
      context.getHandler(),
    );

    const request = context.switchToHttp().getRequest();
    
    const actualDepth = request.actualCallDepth;

    if (!config) {
      return true;
    }

    if (actualDepth === undefined || actualDepth === null) {
      this.logger.debug(
        `Call depth not yet computed for endpoint '${config.endpoint || 'unknown'}' - deferring to service layer`,
      );
      request._maxCallDepthConfig = config;
      return true;
    }

    if (actualDepth > config.maxDepth) {
      const message = `Cross-contract call depth ${actualDepth} exceeds maximum allowed depth ${config.maxDepth}${config.endpoint ? ` for endpoint '${config.endpoint}'` : ''}`;

      if (config.onViolation === 'warn') {
        this.logger.warn(`Call depth warning (guard): ${message}`);
        return true;
      }

      this.logger.error(`Call depth violation (guard): ${message}`);
      throw new ConflictException({
        statusCode: 409,
        message,
        actualDepth,
        maxDepth: config.maxDepth,
        endpoint: config.endpoint,
        error: 'CallDepthExceeded',
      });
    }

    this.logger.debug(
      `Call depth ${actualDepth} within limit ${config.maxDepth} for endpoint '${config.endpoint || 'unknown'}'`,
    );
    return true;
  }
}