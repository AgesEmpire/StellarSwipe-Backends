import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters";
import {
  LoggingInterceptor,
  TransformInterceptor,
} from './common/interceptors';
import { LoggerService } from './common/logger';
import { SentryService } from './common/sentry';

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
  const corsConfig = configService.get("app.cors");
  const globalPrefix = `${apiPrefix}/${apiVersion}`;

  // Set global prefix
  app.setGlobalPrefix(globalPrefix);

  // Enable CORS
  app.enableCors(corsConfig);

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global filters
  app.useGlobalFilters(new GlobalExceptionFilter(logger, sentryService));

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor(logger));
  app.useGlobalInterceptors(new TransformInterceptor());

  // Swagger Setup
  const config = new DocumentBuilder()
    .setTitle('StellarSwipe API')
    .setDescription('Copy trading DApp on Stellar')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${globalPrefix}/docs`, app, document);

  await app.listen(port, host, () => {
    logger.info(`🚀 StellarSwipe Backend running on http://${host}:${port}`);
    logger.info(
      `📚 API available at http://${host}:${port}${globalPrefix}`,
    );
  });

  // Unhandled rejection handler
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('Unhandled Rejection', reason, {
      promise: String(promise),
    });
    sentryService.captureException(
      reason instanceof Error ? reason : new Error(String(reason)),
      {
        type: 'unhandledRejection',
      },
    );
  });

  // Uncaught exception handler
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', error);
    sentryService.captureException(error, {
      type: 'uncaughtException',
    });
    // Give time for logging and Sentry to flush
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM signal received: closing HTTP server');
    await sentryService.flush();
    await app.close();
  });


}

bootstrap().catch((err) => {
  console.error("Failed to start application:", err);
  process.exit(1);
});
