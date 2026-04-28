import {
  Injectable,
  CanActivate,
  ExecutionContext,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DarkLaunchService } from './dark-launch.service';
import { DARK_LAUNCH_KEY } from './dark-launch.decorator';

@Injectable()
export class DarkLaunchGuard implements CanActivate {
  private readonly logger = new Logger(DarkLaunchGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly darkLaunchService: DarkLaunchService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const feature = this.reflector.get<string>(DARK_LAUNCH_KEY, context.getHandler());

    // No decorator → not a dark-launched route, always allow
    if (!feature) return true;

    const request = context.switchToHttp().getRequest();
    // Resolve userId from JWT-authenticated user or fall back to IP for
    // unauthenticated endpoints — auth guards run before this guard.
    const userId: string = request.user?.id ?? request.ip ?? 'anonymous';

    const result = this.darkLaunchService.evaluate(feature, userId);

    this.logger.debug(
      `DarkLaunch [${feature}] user=${userId} enabled=${result.enabled} reason=${result.reason}`,
    );

    if (!result.enabled) {
      // Return 404 instead of 403 to avoid leaking that the feature exists
      throw new NotFoundException();
    }

    // Attach result to request so controllers can read variant/reason
    request.darkLaunch = result;
    return true;
  }
}
