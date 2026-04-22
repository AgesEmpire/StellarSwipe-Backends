import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { I18nValidationExceptionFilter, I18nValidationPipe } from 'nestjs-i18n';
import * as compression from 'compression';
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters";
import {
  LoggingInterceptor,
  TransformInterceptor,
} from './common/interceptors';
import { LoggerService } from './common/logger';
import { SentryService } from './common/sentry';
import { SanitizationPipe } from './common/pipes';
import { RedisIoAdapter } from './websocket/adapters/redis-io.adapter';
import { InstanceCoordinatorService } from './scaling/instance-coordinator.service';
import { compressionConfig } from './common/config/compression.config';
import { MetricsInterceptor } from './monitoring/metrics/metrics.interceptor';
import { initTracing } from './monitoring/tracing/jaeger.config';
import { DocGeneratorService } from './documentation/doc-generator.service';
import { generateOpenApiDocument } from './documentation/generators/openapi-generator';

initTracing();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
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

  // Set global prefix
  app.setGlobalPrefix(globalPrefix);

  // Enable CORS
  app.enableCors({
    origin: corsOrigin,
    credentials: corsCredentials,
  });

  // Enable compression
  app.use((compression as any)(compressionConfig));

  // Track in-flight requests for graceful drain
  let inFlightRequests = 0;
  app.use((_req: any, _res: any, next: () => void) => {
    inFlightRequests++;
    _res.on('finish', () => { inFlightRequests--; });
    _res.on('close', () => { inFlightRequests--; });
    next();
  });

  app.enableShutdownHooks();

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

  // Global filters
  app.useGlobalFilters(
    new GlobalExceptionFilter(logger, sentryService),
    new I18nValidationExceptionFilter({ detailedErrors: false }),
  );

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor(logger));
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalInterceptors(app.get(MetricsInterceptor));

  // Swagger Setup — uses the doc generator's DocumentBuilder for consistency
  const { document, json, yaml } = generateOpenApiDocument(app);
  SwaggerModule.setup(`${globalPrefix}/docs`, app, document);

  // Feed the live document into the doc generator and trigger initial generation
  const docGenerator = app.get(DocGeneratorService);
  docGenerator.setDocument(document);
  docGenerator.generateAll().catch((err) => logger.error('Initial doc generation failed', err));

  // V1 Swagger (Deprecated)
  const configV1 = new DocumentBuilder()
    .setTitle('StellarSwipe API v1 (Deprecated)')
    .setDescription('Legacy API - Sunset: 2025-12-31')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const documentV1 = SwaggerModule.createDocument(app, configV1);
  SwaggerModule.setup('api/v1/docs', app, documentV1);

  await app.listen(port, host, () => {
    logger.info(`🚀 StellarSwipe Backend running on http://${host}:${port}`);
    logger.info(`📚 API available at http://${host}:${port}${globalPrefix}`);
    logger.info(`📚 Swagger documentation at http://${host}:${port}${globalPrefix}/docs`);
  });

  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('Unhandled Rejection', reason, { promise: String(promise) });
    sentryService.captureException(
      reason instanceof Error ? reason : new Error(String(reason)),
      { type: 'unhandledRejection' },
    );
  });

  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', error);
    sentryService.captureException(error, { type: 'uncaughtException' });
    setTimeout(() => process.exit(1), 1000);
  });

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received: starting graceful shutdown');

    // Stop accepting new connections
    await app.close();

    // Drain in-flight requests (max 30 s)
    const drainTimeout = 30_000;
    const drainStart = Date.now();
    while (inFlightRequests > 0 && Date.now() - drainStart < drainTimeout) {
      logger.info(`Draining ${inFlightRequests} in-flight request(s)…`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (inFlightRequests > 0) {
      logger.warn(`Shutdown forced with ${inFlightRequests} request(s) still in-flight`);
    } else {
      logger.info('All in-flight requests drained. Shutdown complete.');
    }

    await sentryService.flush();
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  console.error("Failed to start application:", err);
  process.exit(1);
});
