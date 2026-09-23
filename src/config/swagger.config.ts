import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Builds the OpenAPI document configuration, including the security schemes
 * that describe how clients authenticate against the API.
 *
 * The generated schema documents:
 *  - Bearer (JWT) authentication for user-facing endpoints.
 *  - API key authentication (via the `X-API-Key` header) for service-to-service calls.
 *  - The permission scopes that can be requested/required by protected endpoints.
 */
export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('API')
    .setDescription(
      'Service API. Authenticate using a Bearer JWT for user sessions or an ' +
        'API key (`X-API-Key`) for machine-to-machine integrations. Protected ' +
        'endpoints declare the permission scopes they require.',
    )
    .setVersion('1.0')
    // Primary authentication flow: Bearer JWT issued to authenticated users.
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'JWT access token. Send as `Authorization: Bearer <token>`.',
      },
      'bearer',
    )
    // API key flow for service-to-service / programmatic access.
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description:
          'API key issued to trusted integrations. Send as the `X-API-Key` header.',
      },
      'api-key',
    )
    // OAuth2 flow documenting the permission scopes enforced by the API.
    .addOAuth2(
      {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: '/oauth/authorize',
            tokenUrl: '/oauth/token',
            scopes: {
              'read:all': 'Read access to all resources',
              'write:all': 'Write access to all resources',
              'read:webhooks': 'Read webhook configurations and deliveries',
              'write:webhooks': 'Create, update, and delete webhook configurations',
            },
          },
        },
      },
      'oauth2',
    )
    .addSecurityRequirements('bearer')
    .build();
}

/**
 * Registers the Swagger/OpenAPI module on the given Nest application using the
 * shared security-aware configuration.
 */
export function setupSwagger(app: INestApplication): void {
  const config = buildSwaggerConfig();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
}
