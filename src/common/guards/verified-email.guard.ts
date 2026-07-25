import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_VERIFIED_EMAIL_KEY } from '../decorators/require-verified-email.decorator';

/**
 * Guard that enforces email verification on endpoints decorated with @RequireVerifiedEmail().
 * Must be composed after an authentication guard so req.user is populated.
 * Endpoints without @RequireVerifiedEmail() are completely unaffected.
 */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_VERIFIED_EMAIL_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required.');
    }

    if (!user.emailVerified) {
      throw new ForbiddenException(
        'EMAIL_NOT_VERIFIED: This action requires a verified email address.',
      );
    }

    return true;
  }
}
