import { CorsOptions } from 'cors';

export function createCorsOptions(allowlist: string[] | string | undefined, credentials = true, env = 'development'): CorsOptions {
  const list = Array.isArray(allowlist) ? allowlist : typeof allowlist === 'string' ? allowlist.split(',') : [];

  // In production-like env (mainnet) require an explicit non-empty allowlist
  const isProd = env === 'mainnet' || env === 'production';
  if (isProd && (!list || list.length === 0)) {
    throw new Error('CORS allowlist must be explicitly configured in production');
  }

  // If allowlist contains '*' then allow all origins
  if (list.includes('*')) {
    return { origin: true, credentials };
  }

  // Return function that verifies incoming origin against allowlist
  const originChecker = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return callback(null, true); // allow non-browser requests (curl, server)
    if (list.includes(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  };

  return { origin: originChecker, credentials };
}
