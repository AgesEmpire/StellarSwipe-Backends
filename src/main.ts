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

async function bootstrap() {
  const maxJsonDepth = resolveMaxJsonDepth();

  const app = await NestFactory.create(AppModule);

  app.use(rejectAmbiguousHeaders);

  app.use(createJsonDepthGuard(maxJsonDepth));

  app.enableCors(resolveCorsOptions());

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
