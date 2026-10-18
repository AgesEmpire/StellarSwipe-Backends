/**
 * scripts/validate-deprecation-sunset.ts
 *
 * CI check for #1379 — walks every registered HTTP route's `@Deprecated()`/
 * `@ApiDeprecated()` metadata (and, separately, the generated OpenAPI
 * document's `deprecated`/`x-sunset` fields) and fails the build when any
 * deprecated endpoint has a missing or malformed sunset date. See
 * src/versioning/validation/deprecation-sunset-validator.ts for the
 * validation rules and src/versioning/decorators for the decorators.
 *
 * Run via:
 *   npx ts-node -r tsconfig-paths/register scripts/validate-deprecation-sunset.ts
 * or:
 *   npm run validate:deprecation-sunset
 */
import { NestFactory } from '@nestjs/core';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import {
  DEPRECATED_KEY,
  DEPRECATION_METADATA_KEY,
} from '../src/versioning/decorators/deprecated.decorator';
import {
  collectOpenApiDeprecatedRoutes,
  RouteDeprecationInfo,
  validateDeprecationSunsets,
} from '../src/versioning/validation/deprecation-sunset-validator';

/**
 * Bootstraps the app and walks every controller's prototype methods,
 * reading the `@Deprecated()` decorator metadata directly off each handler.
 * This is the only way to catch deprecations declared via the bare
 * `@Deprecated()` decorator (runtime headers only), which never reach the
 * generated OpenAPI document.
 */
async function collectRouteMetadata(): Promise<RouteDeprecationInfo[]> {
  const app = await NestFactory.create(AppModule, { logger: false });
  const reflector = app.get(Reflector);
  const modulesContainer = app.get(ModulesContainer);

  const routes: RouteDeprecationInfo[] = [];

  for (const module of modulesContainer.values()) {
    for (const wrapper of module.controllers.values()) {
      const instance = wrapper.instance;
      if (!instance) continue;

      const prototype = Object.getPrototypeOf(instance);
      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        if (methodName === 'constructor') continue;

        const handler = prototype[methodName];
        if (typeof handler !== 'function') continue;

        const isDeprecated = reflector.get<boolean>(DEPRECATED_KEY, handler) ?? false;
        if (!isDeprecated) continue;

        const metadata = reflector.get(DEPRECATION_METADATA_KEY, handler);
        routes.push({
          route: `${instance.constructor.name}.${methodName}`,
          isDeprecated: true,
          metadata,
        });
      }
    }
  }

  await app.close();
  return routes;
}

async function main(): Promise<void> {
  const specPath = join(__dirname, '..', 'docs', 'generated', 'openapi.json');

  const [metadataRoutes, openApiRoutes] = await Promise.all([
    collectRouteMetadata(),
    Promise.resolve(collectOpenApiDeprecatedRoutes(specPath)),
  ]);

  const metadataIssues = validateDeprecationSunsets(metadataRoutes).map((issue) => ({
    ...issue,
    source: 'route-metadata' as const,
  }));
  const openApiIssues = validateDeprecationSunsets(openApiRoutes).map((issue) => ({
    ...issue,
    source: 'openapi-document' as const,
  }));

  const issues = [...metadataIssues, ...openApiIssues];

  if (issues.length > 0) {
    console.error(`\n❌  ${issues.length} deprecated route(s) have missing or invalid sunset metadata:\n`);
    for (const issue of issues) {
      console.error(`  - [${issue.source}:${issue.reason}] ${issue.detail}`);
    }
    console.error(
      '\nFix: set a valid sunsetDate (YYYY-MM-DD) on the @Deprecated()/@ApiDeprecated() decorator for the affected route(s).\n',
    );
    process.exitCode = 1;
    return;
  }

  const deprecatedCount =
    metadataRoutes.filter((r) => r.isDeprecated).length +
    openApiRoutes.filter((r) => r.isDeprecated).length;
  console.log(`✅  All deprecated routes (${deprecatedCount}) have valid sunset metadata.`);
}

main().catch((err) => {
  console.error('Failed to validate deprecation sunset metadata:', err);
  process.exit(1);
});
