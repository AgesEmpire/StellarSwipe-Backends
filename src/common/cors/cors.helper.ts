import { CorsOptions } from 'cors';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Correlation-ID', 'Idempotency-Key'];

export function createCorsOptions(allowlist: string[] | string | undefined, credentials = true, env = 'development'): CorsOptions {
  const list = Array.isArray(allowlist) ? allowlist : typeof allowlist === 'string' ? allowlist.split(',') : [];

  const isProd = env === 'mainnet' || env === 'production';
  if (isProd && (!list || list.length === 0)) {
    throw new Error('CORS allowlist must be explicitly configured in production');
  }

  if (list.includes('*')) {
    return { origin: true, credentials, methods: ALLOWED_METHODS, allowedHeaders: ALLOWED_HEADERS };
  }

  const originChecker = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return callback(null, true);
    if (list.includes(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  };

  return { origin: originChecker, credentials, methods: ALLOWED_METHODS, allowedHeaders: ALLOWED_HEADERS };
}
