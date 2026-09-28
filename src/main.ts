import { NestFactory, Reflector } from "@nestjs/core";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { VersioningType } from '@nestjs/common';
import { I18nValidationPipe } from 'nestjs-i18n';
import * as compression from 'compression';
import { AppModule } from "./app.module";
import { ProblemDetailsFilter } from "./common/filters";
import { ErrorClassificationService } from "./common/error-classification";
import { RateLimitMiddleware } from './common/middleware/rate-limit.middleware';
import {
  LoggingInterceptor,
  TimeoutInterceptor,
  SensitiveDataInterceptor,
  ResponseEnvelopeInterceptor,
  StellarMemoInterceptor,
  StripInternalFieldsInterceptor,
  CorrelationIdInterceptor,
} from './common/interceptors';
import { LoggerService } from './common/logger';
import { CorrelationIdStore } from './common/correlation/correlation-id.store';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { SentryService } from './common/sentry';
import { ShutdownService, ShutdownGuardMiddleware } from './common/shutdown';
import { ReadinessService } from './health/readiness.service';
import { SanitizationPipe } from './common/pipes';
import { RedisIoAdapter } from './websocket/adapters/redis-io.adapter';
import { InstanceCoordinatorService } from './scaling/instance-coordinator.service';
import { compressionConfig } from './common/config/compression.config';
import { MetricsInterceptor } from './monitoring/metrics/metrics.interceptor';
import { DeadlockRetryInterceptor } from './database/deadlock-retry.interceptor';
import { NPlus1DetectionInterceptor } from './database/nplus1-detection.interceptor';
import { QueryPerformanceService } from './database/query-performance.service';
import { initTracing } from './monitoring/tracing/jaeger.config';
import { DocGeneratorService } from './documentation/doc-generator.service';
import { generateOpenApiDocument } from './documentation/generators/openapi-generator';
import { DeprecationInterceptor } from './versioning/interceptors/deprecation.interceptor';
import { VersionCompatibilityGuard } from './versioning/guards/version-compatibility.guard';
import { VersionManagerService } from './versioning/version-manager.service';
import { RequestSizeLimitMiddleware } from './common/middleware/request-size-limit.middleware';

initTracing();

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

  // Track in-flight requests for graceful drain
  let inFlightRequests = 0;
  app.use((_req: any, _res: any, next: () => void) => {
    inFlightRequests++;
    _res.on('finish', () => { inFlightRequests--; });
    _res.on('close', () => { inFlightRequests--; });
    next();
  });

  // NOTE: we deliberately do NOT call app.enableShutdownHooks() here. It
  // would register its own SIGTERM/SIGINT listeners that call
  // callShutdownHook() (running onModuleDestroy/onApplicationShutdown on
  // every provider — closing the DB, Redis clients and BullMQ workers)
  // immediately on signal receipt, racing with the bounded in-flight drain
  // below. Lifecycle hooks still fire correctly because app.close() (called
  // explicitly in gracefulShutdown) always runs them — enableShutdownHooks()
  // only wires up automatic signal handling, which we do ourselves so we
  // control the order: reject new traffic → drain → close.

  // Global pipes
  app.useGlobalPipes(
    new SanitizationPipe(),
    new I18nValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Redis Adapter for WebSockets
  const redisIoAdapter = new RedisIoAdapter(app, configService);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // Instance Identification in Logs
  const instanceCoordinator = app.get(InstanceCoordinatorService);
  logger.info(`Application started on instance: ${instanceCoordinator.getInstanceId()}`);

  // Global filter — single RFC 7807 Problem Details filter for every
  // validation, domain, authentication and unexpected error (#1056).
  const errorClassifier = app.get(ErrorClassificationService);
  app.useGlobalFilters(
    new ProblemDetailsFilter(logger, sentryService, errorClassifier, configService),
  );

  // Global interceptors
  app.useGlobalInter

/* … truncated 4486 chars — edit only what you need near the top … */
