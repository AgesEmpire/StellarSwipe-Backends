import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT = 'rateLimit';

export interface RateLimitOptions {
  windowMs: number; // time window in milliseconds
  maxRequests: number; // max requests per window
}

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT, options);
