import { applyDecorators } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Deprecated, DeprecationOptions } from './deprecated.decorator';

/**
 * Marks an endpoint deprecated at runtime (headers via DeprecationInterceptor)
 * and in generated OpenAPI docs (deprecated flag, sunset headers, 410 response).
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
    ApiHeader({ name: 'Deprecation', required: false, description: 'Present with value "true" on deprecated endpoints' }),
    ApiHeader({ name: 'Sunset', required: false, description: `Removal date (${options.sunsetDate})` }),
    ApiResponse({ status: 410, description: 'Endpoint or API version has been sunset' }),
  );
};
