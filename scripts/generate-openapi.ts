/**
 * scripts/generate-openapi.ts
 *
 * Bootstraps the NestJS application without starting the HTTP listener,
 * extracts the full OpenAPI spec via @nestjs/swagger, and writes it to
 * docs/generated/openapi.json.
 *
 * Run via:
 *   npx ts-node -r tsconfig-paths/register scripts/generate-openapi.ts
 *
 * or via the npm script:
 *   npm run export:openapi
 */

import { INestApplication } from '@nestjs/common';
import { ModulesContainer, NestFactory, Reflector } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import {
  DEPRECATED_KEY,
  DEPRECATION_METADATA_KEY,
  DeprecationOptions,
} from '../src/versioning/decorators/deprecated.decorator';

/**
 * Fails generation when the runtime @Deprecated() policy and the OpenAPI
 * operations disagree (deprecated flag or x-sunset). Operations are matched
 * by Swagger's default operationId: `<ControllerClass>_<methodName>`.
 */
function assertDeprecationPolicyMatchesSpec(app: INestApplication, document: OpenAPIObject): void {
  const reflector = app.get(Reflector);
  const expected = new Map<string, string | undefined>();

  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;

      for (const name of Object.getOwnPropertyNames(metatype.prototype)) {
        const handler = metatype.prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;

        const isDeprecated = reflector.getAllAndOverride<boolean>(DEPRECATED_KEY, [handler, metatype]);
        if (!isDeprecated) continue;

        const options = reflector.getAllAndOverride<DeprecationOptions>(DEPRECATION_METADATA_KEY, [
          handler,
          metatype,
        ]);
        expected.set(`${metatype.name}_${name}`, options?.sunsetDate);
      }
    }
  }

  const actual = new Map<string, { sunset?: string }>();
  for (const methods of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(methods ?? {}) as any[]) {
      if (operation?.deprecated === true) {
        actual.set(operation.operationId, { sunset: operation['x-sunset'] });
      }
    }
  }

  const mismatches: string[] = [];
  for (const [id, sunset] of expected) {
    const op = actual.get(id);
    if (!op) mismatches.push(`${id}: deprecated at runtime but not deprecated in OpenAPI`);
    else if (op.sunset !== sunset) {
      mismatches.push(`${id}: runtime sunset ${sunset} but OpenAPI x-sunset ${op.sunset}`);
    }
  }
  for (const id of actual.keys()) {
    if (!expected.has(id)) mismatches.push(`${id}: deprecated in OpenAPI but not at runtime`);
  }

  if (mismatches.length > 0) {
    throw new Error(`Deprecation policy disagrees with OpenAPI:\n  - ${mismatches.join('\n  - ')}`);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });

  const config = new DocumentBuilder()
    .setTitle('StellarSwipe API')
    .setDescription('StellarSwipe backend REST API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  assertDeprecationPolicyMatchesSpec(app, document);

  const outputDir = join(__dirname, '..', 'docs', 'generated');
  mkdirSync(outputDir, { recursive: true });

  const outputPath = join(outputDir, 'openapi.json');
  writeFileSync(outputPath, JSON.stringify(document, null, 2));

  console.log(`OpenAPI spec written to ${outputPath}`);
  await app.close();
}

bootstrap().catch((err) => {
  console.error('Failed to generate OpenAPI spec:', err);
  process.exit(1);
});
