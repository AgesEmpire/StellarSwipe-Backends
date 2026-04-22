import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

/**
 * #369 — Audited configuration service.
 *
 * Wraps NestJS ConfigService to expose only the environment variables that are
 * actively used by the application (as documented in .env.example and validated
 * by src/config/schemas/config.schema.ts).
 *
 * Previously unused variables (DATABASE_SYNCHRONIZE, LOG_MAX_FILES, LOG_MAX_SIZE,
 * MONTHLY_REPORT_ENABLED, AUTO_DELETE_EXPORTS_DAYS) have been removed from
 * runtime access paths. They remain in .env.example marked as optional/legacy
 * so operators are not surprised, but no code reads them here.
 *
 * Required at runtime (application will not start without these — enforced by
 * the Joi schema in config.schema.ts):
 *   DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME
 *   REDIS_HOST, REDIS_PORT
 *   JWT_SECRET
 *   STELLAR_NETWORK, STELLAR_HORIZON_URL, STELLAR_SOROBAN_RPC_URL, STELLAR_NETWORK_PASSPHRASE
 *   XAI_API_KEY
 */
@Injectable()
export class ConfigService {
  constructor(private readonly config: NestConfigService) {}

  // ── Application ────────────────────────────────────────────────────────────
  get nodeEnv(): string {
    return this.config.get<string>('app.environment', 'development');
  }

  get port(): number {
    return this.config.get<number>('app.port', 3000);
  }

  get host(): string {
    return this.config.get<string>('app.host', 'localhost');
  }

  // ── Database ───────────────────────────────────────────────────────────────
  get databaseHost(): string {
    return this.config.getOrThrow<string>('database.host');
  }

  get databasePort(): number {
    return this.config.getOrThrow<number>('database.port');
  }

  // ── Redis / Queue ──────────────────────────────────────────────────────────
  get redisHost(): string {
    return this.config.get<string>('redis.host', 'localhost');
  }

  get redisPort(): number {
    return this.config.get<number>('redis.port', 6379);
  }

  get redisPassword(): string | undefined {
    return this.config.get<string>('redis.password');
  }

  // ── Authentication ─────────────────────────────────────────────────────────
  get jwtSecret(): string {
    return this.config.getOrThrow<string>('jwt.secret');
  }

  get jwtExpiresIn(): string {
    return this.config.get<string>('jwt.expiresIn', '7d');
  }

  // ── Tracing ────────────────────────────────────────────────────────────────
  get tracingEnabled(): boolean {
    return process.env.TRACING_ENABLED === 'true';
  }

  get tracingServiceName(): string {
    return process.env.TRACING_SERVICE_NAME ?? 'stellarswipe-backend';
  }
}
