import { registerAs } from '@nestjs/config';

export const nplus1DetectionConfig = registerAs('nplus1Detection', () => ({
  maxQueriesPerRequest: parseInt(process.env.NPLUS1_MAX_QUERIES || '25', 10),
  maxQueryTimeMs: parseInt(process.env.NPLUS1_MAX_QUERY_TIME_MS || '1000', 10),
  /** Enable structured logging for N+1 warnings even in production */
  logInProduction: process.env.NPLUS1_LOG_IN_PRODUCTION === 'true',
  /** A single query shape repeated this many times in one request is flagged as N+1 */
  repeatThreshold: parseInt(process.env.NPLUS1_REPEAT_THRESHOLD || '5', 10),
  /** Comma-separated regexes matched against normalized SQL or "METHOD /route" for intentional patterns */
  allowlist: (process.env.NPLUS1_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean),
  /** Throw instead of logging (use in test runs to fail on regressions) */
  failOnDetect: process.env.NPLUS1_FAIL_ON_DETECT === 'true',
}));
