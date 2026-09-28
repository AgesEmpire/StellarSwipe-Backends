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

import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';

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
