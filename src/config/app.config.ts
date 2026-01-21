import { registerAs } from '@nestjs/config';
import { AppConfig, SentryConfig } from './schemas/config.interface';

export const appConfig = registerAs(
  'app',
  (): AppConfig => ({
    port: parseInt(process.env.PORT || '3000', 10),
    environment: (process.env.NODE_ENV || 'development') as
      | 'development'
      | 'testnet'
      | 'mainnet',
    host: process.env.HOST || '0.0.0.0',
    apiPrefix: process.env.API_PREFIX || 'api',
    apiVersion: process.env.API_VERSION || 'v1',
    logLevel: process.env.LOG_LEVEL || 'debug',
    logDirectory: process.env.LOG_DIRECTORY || './logs',
    logMaxFiles: process.env.LOG_MAX_FILES || '14d',
    logMaxSize: process.env.LOG_MAX_SIZE || '20m',
    corsOrigin: process.env.CORS_ORIGIN?.split(',') || [
      'http://localhost:3000',
    ],
    corsCredentials: process.env.CORS_CREDENTIALS !== 'false',
  }),
);

export const sentryConfig = registerAs(
  'sentry',
  (): SentryConfig => ({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1',
    ),
  }),
);
