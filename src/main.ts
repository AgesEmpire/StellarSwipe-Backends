import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

const PROTECTED_HEADERS = ['authorization', 'host', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip'];

const DEFAULT_MAX_JSON_DEPTH = 32;

function rejectAmbiguousHeaders(req: any, res: any, next: () => void): void {
  for (const name of PROTECTED_HEADERS) {
    const raw = req.headers[name];
    if (raw === undefined) {
      continue;
    }
    const values = Array.isArray(raw) ? raw : [raw];
    const normalized = values.map((v: string) => String(v).trim().toLowerCase());
    const hasConflict = normalized.some((v: string) => v !== normalized[0]);
    if (values.length > 1 || hasConflict) {
      res.status(400).json({
        statusCode: 400,
        error: 'Bad Request',
        message: `Duplicate or conflicting ${name} header is not allowed`,
      });
      return;
    }
  }
  next();
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function isValidOriginPattern(origin: string): boolean {
  if (origin === '*') {
    return true;
  }
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === origin;
  } catch {
    return false;
  }
}

function resolveCorsOptions(): { origin: string[] | boolean; credentials: boolean } {
  const credentials = String(process.env.CORS_CREDENTIALS ?? '').toLowerCase() === 'true';
  const origins = parseAllowedOrigins(process.env.CORS_ORIGINS);

  for (const origin of origins) {
    if (!isValidOriginPattern(origin)) {
      throw new Error(`Invalid CORS origin pattern: ${origin}`);
    }
  }

  if (credentials && origins.includes('*')) {
    throw new Error('CORS wildcard origin cannot be combined with credentials');
  }

  if (origins.length === 0) {
    return { origin: false, credentials };
  }

  return { origin: origins, credentials };
}

function resolveMaxJsonDepth(): number {
  const raw = process.env.MAX_JSON_DEPTH;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_MAX_JSON_DEPTH;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid MAX_JSON_DEPTH: ${raw} (expected a positive integer)`);
  }
  return parsed;
}

function exceedsMaxDepth(value: unknown, maxDepth: number, depth = 0): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (depth >= maxDepth) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => exceedsMaxDepth(item, maxDepth, depth + 1));
  }
  return Object.values(value as Record<string, unknown>).some((item) =>
    exceedsMaxDepth(item, maxDepth, depth + 1),
  );
}

function createJsonDepthGuard(maxDepth: number) {
  return function rejectDeepJson(req: any, res: any, next: () => void): void {
    const body = req.body;
    if (body === undefined || body === null) {
      next();
      return;
    }
    if (exceedsMaxDepth(body, maxDepth)) {
      res.status(400).json({
        statusCode: 400,
        error: 'Bad Request',
        message: `JSON body exceeds maximum nesting depth of ${maxDepth}`,
      });
      return;
    }
    next();
  };
}

/**
 * Resolve whether API documentation (OpenAPI JSON + interactive Swagger UI)
 * should be exposed for this deployment (#1406).
 *
 * Docs are disabled by default so production deployments never expose
 * interactive documentation publicly. Enabling them requires an explicit,
 * validated configuration value; invalid values fail fast at bootstrap.
 */
function resolveDocsEnabled(configService: ConfigService): boolean {
  const raw = configService.get<string | boolean>('app.docsEnabled');
  if (raw === undefined || raw === null || raw === '') {
    return false;
  }
  if (typeof raw === 'boolean') {
    return raw;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(
    `Invalid configuration for app.docsEnabled: "${raw}". ` +
      'Expected one of: true, false, 1, 0, yes, no, on, off.',
  );
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  // Get services
  const configService = app.get(ConfigService);
  const logger = app.get(LoggerService);
  const sentryService = app.get(SentryService);

  // Set Winston as the default logger
  app.useLogger(logger);
  logger.setContext('Bootstrap');

  // Validate cross-field configuration relationships (network endpoints,
  // retry limits, timeout budgets) before wiring up any runtime behaviour.
  // Invalid combinations abort startup with actionable errors (#1232).
  validateConfigurationRelationships(configService);

  // Resolve docs exposure policy early so an invalid value aborts startup
  // before any routes are wired (#1406).
  const docsEnabled = resolveDocsEnabled(configService);

  // Initialize Sentry
  sentryService.init();

  // Get configuration
  const port = configService.get("app.port");
  const host = configService.get("app.host");
  const apiPrefix = configService.get("app.apiPrefix");
  const apiVersion = configService.get("app.apiVersion");
  const corsOrigin = configService.get("app.corsOrigin");
  const corsCredentials = configService.get("app.corsCredentials");
  const globalPrefix = `${apiPrefix}/${apiVersion}`;

  // Enforce explicit request payload and parameter size limits (#1166).
  // All limits are configurable via env/config (see request-size-limit.config).
  // The middleware rejects oversized JSON bodies, multipart uploads, query
  // strings, headers and route parameters with a stable 413/414/431 Problem
  // Details response before any expensive processing occurs.
  const requestSizeLimitMiddleware = app.get(RequestSizeLimitMiddleware);
  app.use(requestSizeLimitMiddleware.use.bind(requestSizeLimitMiddleware));

  // Align the body-parser limit with the configured max JSON payload size so
  // the parser and the middleware agree on the boundary.
  const jsonLimit = configService.get<string>('requestLimits.json') ?? '5mb';
  const urlencodedLimit = configService.get<string>('requestLimits.urlencoded') ?? '5mb';
  app.useBodyParser('json', { limit: jsonLimit });
  app.useBodyParser('urlencoded', { limit: urlencodedLimit, extended: true });

  // Set global prefix
  app.setGlobalPrefix(globalPrefix);

  // Enable URI-based API versioning (e.g. /api/v1/..., /api/v2/...)
  app.enableVersioning({ type: VersioningType.URI });

  // Register deprecation interceptor globally so @Deprecated() headers are
  // emitted on any handler decorated with it, without touching auth logic.
  app.useGlobalInterceptors(new DeprecationInterceptor(app.get(Reflector)));

  // Correlation ID must run first so every downstream log/response carries it
  app.use(correlationIdMiddleware);
  // Enforce @ApiVersion()-pinned handlers against the live version registry
  // (rejects sunset versions with 410 Gone, mirrors deprecation headers for
  // deprecated ones). Registered on the HTTP app instance — like the
  // interceptor above — rather than via the APP_GUARD DI token, so it only
  // applies to HTTP routes and never intercepts the TCP microservice
  // listener's @MessagePattern handlers connected further below.
  app.useGlobalGuards(
    new VersionCompatibilityGuard(app.get(Reflector), app.get(VersionManagerService)),
  );

  // Enable CORS
  // Build CORS options using helper which validates production config
  const { createCorsOptions } = await import('./common/cors/cors.helper');
  const corsOptions = createCorsOptions(corsOrigin, corsCredentials, configService.get('app.environment'));
  app.enableCors(corsOptions);

  // Enable compression
  app.use((compression as any)(compressionConfig));

  // Assign/propagate the correlation ID before anything else runs, so every
  // downstream middleware, guard, interceptor and service can tag its logs
  // with it for the lifetime of the request.
  const correlationIdMiddleware = app.get(CorrelationIdMiddleware);
  app.use(correlationIdMiddleware.use.bind(correlationIdMiddleware));

  // Reject new traffic as soon as graceful shutdown begins (#1058), ahead of
  // rate limiting and routing so a request that arrives mid-drain gets an
  // immediate 503 instead of being handled with resources that are
  // mid-teardown.
  const shutdownService = app.get(ShutdownService);
  const shutdownGuardMiddleware = app.get(ShutdownGuardMiddleware);
  app.use(shutdownGuardMiddleware.use.bind(shutdownGuardMiddleware));

  // Apply global rate limiting middleware before any request reaches route handlers.
  // The middleware distinguishes anonymous traffic, authenticated users and
  // suspicious IP ranges, and enforces per-tier limits across all endpoints
  // (including public APIs). It runs after correlation-id so denials are
  // traceable, and before auth so abusive traffic is shed early.
  const rateLimitMiddleware = app.get(RateLimitMiddleware);
  app.use(rateLimitMiddleware.use.bind(rateLimitMiddleware));

  // Enforce endpoint-appropriate request deadlines (#1306). The timeout
  // interceptor aborts long-running handlers with a consistent 408 Problem
  // Details response and propagates cancellation to supported downstream
  // operations so timed-out work cannot keep producing side effects.
  const requestTimeoutMs = configService.get<number>('app.requestTimeoutMs') ?? 30000;
  app.useGlobalInterceptors(new TimeoutInterceptor(requestTimeoutMs));

  // Expose OpenAPI JSON and interactive Swagger UI only when explicitly
  // enabled for this deployment (#1406). When disabled (the default), the
  // documentation routes are never registered, so they cannot be reached
  // publicly. When enabled, the routes are mounted under the global prefix
  // and gated by the configured docs auth token so retained docs remain
  // authenticated.
  if (docsEnabled) {
    const docsPath = `${globalPrefix}/docs`;
    const docsJsonPath = `${globalPrefix}/docs-json`;
    const docsAuthToken = configService.get<string>('app.docsAuthToken');

    const swaggerConfig = new DocumentBuilder()
      .setTitle('API Documentation')
      .setDescription('OpenAPI specification for this deployment')
      .setVersion(String(apiVersion ?? '1'))
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);

    // Optional authenticated access: when a docs auth token is configured,
    // require it via the Authorization header (Bearer) or X-Docs-Token header
    // before serving either the JSON spec or the interactive UI.
    if (docsAuthToken) {
      const requireDocsAuth = (req: any, res: any, next: () => void) => {
        const authHeader = req.headers?.authorization;
        const bearer =
          typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
            ? authHeader.slice('Bearer '.length).trim()
            : undefined;
        const provided = bearer ?? req.headers?.['x-docs-token'];
        if (provided !== docsAuthToken) {
          res.status(401).json({
            status: 401,
            title: 'Unauthorized',
            detail: 'API documentation requires authentication.',
          });
          return;
        }
        next();
      };
      app.use(`/${docsPath}`, requireDocsAuth);
      app.use(`/${docsJsonPath}`, requireDocsAuth);
    }

    SwaggerModule.setup(docsPath, app, document);
    logger.log(`API documentation enabled at /${docsPath}`);
  } else {
    logger.log('API documentation disabled by deployment policy');
  }

  await app.listen(port, host);
  logger.log(`Application is running on: http://${host}:${port}/${globalPrefix}`);
}

bootstrap();
