import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_VERIFIED_EMAIL_KEY } from '../decorators/require-verified-email.decorator';
import { EmailNotVerifiedException } from '../exceptions/email-not-verified.exception';

/**
 * Guard that enforces email verification on endpoints decorated with
 * `@RequireVerifiedEmail()`.
 *
 * Must be composed AFTER an authentication guard (e.g. `JwtAuthGuard`) so
 * `req.user` is already populated — see `@RequireVerifiedEmail()` for a usage
 * example. Endpoints without the decorator are completely unaffected.
 */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_VERIFIED_EMAIL_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Opt-in: routes without @RequireVerifiedEmail() are untouched.
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // No authenticated user on the request: defer to the auth guard that
    // should run before this one rather than duplicating its rejection.
    if (!user) {
      return true;
    }

    if (!user.emailVerified) {
      throw new EmailNotVerifiedException();
    }

    return true;
  }
}
