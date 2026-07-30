import { SetMetadata } from '@nestjs/common';

export const EXPOSE_SENSITIVE_FIELDS_KEY = 'exposeSensitiveFields';

/**
 * Opts a controller method or GraphQL resolver field out of the default
 * sensitive-field redaction applied by SensitiveDataInterceptor.
 *
 * By default every response is treated as "public" and fields matching the
 * sensitive-field name patterns (see `common/logger/log-redaction.ts`) are
 * redacted before serialization. Internal/admin endpoints that legitimately
 * need the raw values (e.g. compliance review, support tooling) should be
 * marked explicitly rather than the default silently changing for everyone:
 *
 *   @Get('admin/user/:userId')
 *   @ExposeSensitiveFields()
 *   adminGetUserKyc(...) { ... }
 */
export const ExposeSensitiveFields = () => SetMetadata(EXPOSE_SENSITIVE_FIELDS_KEY, true);
