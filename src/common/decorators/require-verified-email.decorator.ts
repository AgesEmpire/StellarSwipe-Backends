import { SetMetadata } from '@nestjs/common';

export const REQUIRE_VERIFIED_EMAIL_KEY = 'requireVerifiedEmail';

/**
 * Restricts an endpoint to users who have verified their email address.
 * Must be used alongside JwtAuthGuard (or equivalent) and VerifiedEmailGuard.
 *
 * @example
 * ```ts
 * @Get('payout-settings')
 * @UseGuards(JwtAuthGuard, VerifiedEmailGuard)
 * @RequireVerifiedEmail()
 * getPayoutSettings() { ... }
 * ```
 */
export const RequireVerifiedEmail = () => SetMetadata(REQUIRE_VERIFIED_EMAIL_KEY, true);
