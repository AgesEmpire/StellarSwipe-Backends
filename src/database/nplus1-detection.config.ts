import { registerAs } from '@nestjs/config';

export const nplus1DetectionConfig = registerAs('nplus1Detection', () => ({
  maxQueriesPerRequest: parseInt(process.env.NPLUS1_MAX_QUERIES || '25', 10),
  maxQueryTimeMs: parseInt(process.env.NPLUS1_MAX_QUERY_TIME_MS || '1000', 10),
  /** Enable structured logging for N+1 warnings even in production */
  logInProduction: process.env.NPLUS1_LOG_IN_PRODUCTION === 'true',
}));
