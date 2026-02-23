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
    const userId = request.user?.id || request.query?.userId || request.body?.userId;

    if (!userId) {
      throw new ForbiddenException('User ID required for feature flag evaluation');
    }

    const result = await this.flagsService.evaluateFlag(flagName, userId);
    
    if (!result.enabled) {
      throw new ForbiddenException(`Feature ${flagName} is not enabled for this user`);
    }

    request.featureVariant = result.variant;
    return true;
  }
}
