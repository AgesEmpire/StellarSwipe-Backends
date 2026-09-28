import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { AppModule } from '../../src/app.module';

/**
 * Generates the backend OpenAPI document and writes it to a deterministic
 * artifact on disk. This is the single source of truth used both by CI
 * (drift detection) and by developers (regenerate + commit workflow).
 *
 * Usage:
 *   npm run openapi:generate
 *
 * The output path can be overridden with OPENAPI_OUTPUT for CI comparisons.
 */
async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Backend API')
    .setDescription('Reviewed OpenAPI contract for the backend service.')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Deterministic serialization: stable key ordering and trailing newline so
  // the committed artifact does not churn between runs or machines.
  const output = `${stableStringify(document)}\n`;

  const outputPath = resolve(
    process.cwd(),
    process.env.OPENAPI_OUTPUT ?? 'openapi.json',
  );

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output, 'utf8');

  await app.close();

  // eslint-disable-next-line no-console
  console.log(`OpenAPI document written to ${outputPath}`);
}

/**
 * Recursively sorts object keys so the generated document is byte-stable
 * regardless of property insertion order.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, val]) => [key, sortKeys(val)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

generate().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to generate OpenAPI document:', error);
  process.exit(1);
});
