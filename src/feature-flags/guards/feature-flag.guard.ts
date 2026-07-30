import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsService } from '../feature-flags.service';
import { FEATURE_FLAG_KEY } from '../decorators/require-flag.decorator';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private flagsService: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flagName = this.reflector.get<string>(FEATURE_FLAG_KEY, context.getHandler());
    
    if (!flagName) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    // For admin/system-triggered workflows there may be no authenticated end-user;
    // fall back to a stable bucket so boolean/global flags can still be evaluated.
    const userId =
      request.user?.id || request.query?.userId || request.body?.userId || 'system';

    const tenantId = request.user?.tenantId || request.headers?.['x-tenant-id'];
    const result = await this.flagsService.evaluateFlag(flagName, userId, {
      tenantId,
      environment: process.env.NODE_ENV,
    });

    if (!result.enabled) {
      throw new ForbiddenException(
        result.fallback
          ? `Feature ${flagName} is unavailable (safe fallback: ${result.reason})`
          : `Feature ${flagName} is not enabled for this user`,
      );
    }

    request.featureVariant = result.variant;
    return true;
  }
}
