import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { RequestContextModule } from './common/request-context/request-context.module';
import { RequestContextMiddleware } from './common/request-context/request-context.middleware';
import { TenantContextGuard } from './common/request-context/tenant-context.guard';

@Module({
  imports: [RequestContextModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: TenantContextGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }

  /**
   * Builds the OpenAPI document configuration, documenting the supported
   * authentication flows, API key usage, and permission scopes so that
   * generated clients and developers can understand the service contract.
   */
  static buildOpenApiConfig() {
    return new DocumentBuilder()
      .setTitle('API')
      .setDescription(
        'Service contract describing authentication flows, API key usage, and permission scopes.',
      )
      .setVersion('1.0')
      // Bearer token authentication (OAuth2 / JWT authorization code flow).
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'JWT access token obtained through the authorization code flow. Send as `Authorization: Bearer <token>`.',
        },
        'bearer',
      )
      // OAuth2 authorization code flow with permission scopes.
      .addOAuth2(
        {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: '/oauth/authorize',
              tokenUrl: '/oauth/token',
              scopes: {
                'read:resources': 'Read access to resources',
                'write:resources': 'Create and update resources',
                'admin:resources': 'Administrative access to resources',
              },
            },
          },
          description:
            'OAuth2 authorization code flow. Request the permission scopes required by each endpoint.',
        },
        'oauth2',
      )
      // API key authentication for server-to-server integrations.
      .addApiKey(
        {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description:
            'API key issued to trusted integrations. Send as the `X-API-Key` header.',
        },
        'apiKey',
      )
      .addSecurityRequirements('bearer')
      .build();
  }

  /**
   * Registers the OpenAPI document with the given application instance so the
   * security schemes are observable through the generated schema.
   */
  static setupOpenApi(app: Parameters<typeof SwaggerModule.createDocument>[0]) {
    const document = SwaggerModule.createDocument(app, AppModule.buildOpenApiConfig());
    SwaggerModule.setup('api', app, document);
    return document;
  }
}
