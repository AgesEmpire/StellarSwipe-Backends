import { HttpException, HttpStatus } from '@nestjs/common';

/** Stable error code returned in the response body for unverified-email rejections. */
export const EMAIL_NOT_VERIFIED_ERROR_CODE = 'EMAIL_NOT_VERIFIED';

/**
 * Thrown by {@link VerifiedEmailGuard} when an authenticated user without a
 * verified email address hits an endpoint annotated with `@RequireVerifiedEmail()`.
 *
 * Always resolves to HTTP 403 with a typed, machine-readable `code` so clients
 * can distinguish this rejection from other 403s (e.g. permissions, KYC).
 */
export class EmailNotVerifiedException extends HttpException {
  constructor(
    message: string = 'This action requires a verified email address.',
  ) {
    super(
      {
        message,
        error: 'EmailNotVerified',
        code: EMAIL_NOT_VERIFIED_ERROR_CODE,
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
