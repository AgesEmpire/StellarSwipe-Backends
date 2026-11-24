import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

const PROTECTED_HEADERS = ['authorization', 'host', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip'];

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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(rejectAmbiguousHeaders);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
