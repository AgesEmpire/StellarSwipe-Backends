import { SetMetadata } from '@nestjs/common';

export const REQUIRE_VERIFIED_EMAIL_KEY = 'requireVerifiedEmail';

/**
 * Restricts an endpoint (or every endpoint on a controller) to users who have
 * verified their email address. Opt-in only: routes without this decorator
 * are completely unaffected.
 *
 * Apply `VerifiedEmailGuard` *after* your authentication guard so
 * `req.user` is populated before the check runs. Unverified users receive an
 * `EmailNotVerifiedException` (HTTP 403, `code: "EMAIL_NOT_VERIFIED"`).
 *
 * See `docs/verified-email-guard.md` for the full usage guide.
 *
 * @example
 * ```ts
 * @Get('payout-settings')
 * @UseGuards(JwtAuthGuard, VerifiedEmailGuard)
 * @RequireVerifiedEmail()
 * getPayoutSettings() { ... }
 * ```
 *
 * @example Controller-level (applies to every route in the controller)
 * ```ts
 * @UseGuards(JwtAuthGuard, VerifiedEmailGuard)
 * @RequireVerifiedEmail()
 * @Controller('payouts')
 * export class PayoutsController { ... }
 * ```
 */
export const RequireVerifiedEmail = () => SetMetadata(REQUIRE_VERIFIED_EMAIL_KEY, true);
