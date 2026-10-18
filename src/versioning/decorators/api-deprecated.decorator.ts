import { applyDecorators } from '@nestjs/common';
import { ApiExtension, ApiHeader, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Deprecated, DeprecationOptions } from './deprecated.decorator';

/**
 * Marks an endpoint deprecated at runtime (headers via DeprecationInterceptor)
 * and in generated OpenAPI docs (deprecated flag, sunset headers, 410 response).
 *
 * #1379 — `sunsetDate` is also emitted as the `x-sunset` OpenAPI extension
 * (in addition to living in the free-text operation description) so CI's
 * sunset-validation script (scripts/validate-deprecation-sunset.ts) can read
 * it back out of the generated spec as structured data instead of having to
 * parse prose.
 */
export const ApiDeprecated = (options: DeprecationOptions) => {
  const notice = [
    `Deprecated. Sunset date: ${options.sunsetDate}.`,
    options.successorVersion ? `Successor: v${options.successorVersion}.` : '',
    options.reason ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return applyDecorators(
    Deprecated(options),
    ApiOperation({ deprecated: true, description: notice }),
    ApiExtension('x-sunset', options.sunsetDate),
    ApiHeader({ name: 'Deprecation', required: false, description: 'Present with value "true" on deprecated endpoints' }),
    ApiHeader({ name: 'Sunset', required: false, description: `Removal date (${options.sunsetDate})` }),
    ApiResponse({ status: 410, description: 'Endpoint or API version has been sunset' }),
  );
};
