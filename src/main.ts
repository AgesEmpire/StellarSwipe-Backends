import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters";
import {
  LoggingInterceptor,
  TransformInterceptor,
} from "./common/interceptors";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

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
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalInterceptors(new TransformInterceptor());

  await app.listen(port, host, () => {
    console.log(`🚀 StellarSwipe Backend running on http://${host}:${port}`);
    console.log(
      `📚 API available at http://${host}:${port}${globalPrefix}`,
    );
  });
}

bootstrap().catch((err) => {
  console.error("Failed to start application:", err);
  process.exit(1);
});
