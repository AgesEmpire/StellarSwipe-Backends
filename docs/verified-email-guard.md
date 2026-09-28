# Verified Email Guard

## Overview

Some sensitive actions — changing payout destinations, accessing certain reports, etc. —
should only be available to accounts that have verified their email address.
`@RequireVerifiedEmail()` (`src/common/decorators/require-verified-email.decorator.ts`) paired
with `VerifiedEmailGuard` (`src/common/guards/verified-email.guard.ts`) provides an opt-in way
to enforce that on any route, without affecting any endpoint that doesn't ask for it.

## How it works

- `@RequireVerifiedEmail()` sets a small piece of route metadata (`requireVerifiedEmail: true`)
  using Nest's `SetMetadata`, and can be applied to a single handler or to an entire controller.
- `VerifiedEmailGuard` reads that metadata via `Reflector#getAllAndOverride`. If it isn't set,
  the guard is a no-op and returns `true` immediately — endpoints without the decorator are
  completely unaffected.
- When the metadata is set, the guard reads `request.user` (populated by the authentication
  guard that ran before it) and checks `user.emailVerified`:
  - Verified user → request proceeds.
  - Unverified user → throws `EmailNotVerifiedException`
    (`src/common/exceptions/email-not-verified.exception.ts`), an `HttpException` that resolves
    to **HTTP 403** with a JSON body containing `code: "EMAIL_NOT_VERIFIED"` so clients can
    distinguish this rejection from other 403s (permissions, KYC level, etc.).
  - No `request.user` at all (e.g. the guard was accidentally used without an auth guard, or
    is running in some other order) → the guard defers and returns `true`, leaving rejection of
    unauthenticated requests to the authentication guard, consistent with how `KycGuard` and
    `WalletAgeGuard` behave in this codebase.

`VerifiedEmailGuard` only depends on Nest's `Reflector`, so it needs no module wiring — just add
it to a route's `@UseGuards(...)` list.

## Composing with authentication

`VerifiedEmailGuard` **must** run after your authentication guard (`JwtAuthGuard`,
`UnifiedAuthGuard`, etc.) so `request.user` is already populated. Guards passed to `@UseGuards()`
run in array order, so list the auth guard first:

```typescript
import { UseGuards, Get } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VerifiedEmailGuard } from '../common/guards/verified-email.guard';
import { RequireVerifiedEmail } from '../common/decorators/require-verified-email.decorator';

@Get('payout-settings')
@UseGuards(JwtAuthGuard, VerifiedEmailGuard)
@RequireVerifiedEmail()
getPayoutSettings() { ... }
```

### Controller-level usage

Apply it once at the class level to protect every route on the controller:

```typescript
@UseGuards(JwtAuthGuard, VerifiedEmailGuard)
@RequireVerifiedEmail()
@Controller('payouts')
export class PayoutsController {
  @Get('destination')
  getDestination() { ... }

  @Post('destination')
  updateDestination(@Body() dto: UpdatePayoutDestinationDto) { ... }
}
```

## Error response shape

```json
{
  "statusCode": 403,
  "message": "This action requires a verified email address.",
  "error": "EmailNotVerified",
  "code": "EMAIL_NOT_VERIFIED"
}
```

## Testing

See `src/common/guards/verified-email.guard.spec.ts` for unit tests covering:

- A verified user is allowed through.
- An unverified user is rejected with `EmailNotVerifiedException` (HTTP 403, `code:
  "EMAIL_NOT_VERIFIED"`).
- Routes without `@RequireVerifiedEmail()` are unaffected (opt-in only).
- The guard defers to the auth guard rather than double-rejecting when `request.user` is absent.
