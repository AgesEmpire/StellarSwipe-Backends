import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiSecurity,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';

/**
 * Documents the authentication flows, API key usage, and permission scopes
 * supported by the service in the generated OpenAPI schema.
 *
 * - `bearer`: standard JWT bearer authentication (`Authorization: Bearer <token>`).
 * - `apiKey`: service-to-service API key authentication (`X-API-Key: <key>`).
 * - `scopes`: OAuth2-style permission scopes required to call the endpoint.
 */
export interface ApiAuthOptions {
  /**
   * Permission scopes required to access the endpoint. When provided, the
   * scopes are advertised in the OpenAPI security requirement so generated
   * clients can request the correct permissions.
   */
  scopes?: string[];
  /**
   * Whether the endpoint accepts API key authentication in addition to the
   * bearer token. Defaults to `true` so service-to-service callers are
   * documented consistently.
   */
  apiKey?: boolean;
}

/**
 * Applies the shared OpenAPI security documentation to a controller or route.
 *
 * Usage:
 * ```ts
 * @ApiAuth({ scopes: ['webhooks:write'] })
 * @Post()
 * create() { ... }
 * ```
 */
export function ApiAuth(options: ApiAuthOptions = {}): MethodDecorator & ClassDecorator {
  const { scopes = [], apiKey = true } = options;

  const decorators: Array<MethodDecorator & ClassDecorator> = [
    ApiBearerAuth('bearer'),
    ApiUnauthorizedResponse({
      description: 'Missing or invalid authentication credentials.',
    }),
  ];

  if (apiKey) {
    decorators.push(
      ApiSecurity('apiKey'),
      ApiHeader({
        name: 'X-API-Key',
        description: 'Service API key used for machine-to-machine authentication.',
        required: false,
      }),
    );
  }

  if (scopes.length > 0) {
    decorators.push(
      ApiSecurity('scopes', scopes),
      ApiForbiddenResponse({
        description: `Requires one of the following permission scopes: ${scopes.join(', ')}.`,
      }),
    );
  }

  return applyDecorators(...decorators);
}
