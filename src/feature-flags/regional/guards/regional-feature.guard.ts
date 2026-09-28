import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RegionalFlagsService } from '../regional-flags.service';
import { RegionResolver } from '../utils/region-resolver';

export const REGIONAL_FLAG_KEY = 'regional_flag';

export const RequireRegionalFlag = (flagName: string): MethodDecorator & ClassDecorator =>
  SetMetadata(REGIONAL_FLAG_KEY, flagName);

@Injectable()
export class RegionalFeatureGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private regionalFlagsService: RegionalFlagsService,
    private regionResolver: RegionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flagName = this.reflector.getAllAndOverride<string>(REGIONAL_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!flagName) return true;

    const request = context.switchToHttp().getRequest();
    const region = this.regionResolver.resolveFromRequest(request);

    const result = await this.regionalFlagsService.evaluateForRegion(flagName, region, false);

    if (!result.enabled) {
      throw new ForbiddenException(
        `Feature '${flagName}' is not available in region '${region}'`,
      );
    }

    request.regionalFlagContext = { flagName, region, overrides: result.overrides };
    return true;
  }
}
