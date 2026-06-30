import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export enum RateLimitTier {
  PUBLIC = 'public',
  AUTH = 'auth',
  AUTHENTICATED = 'authenticated',
  TRADE = 'trade',
  SIGNAL = 'signal',
  ADMIN = 'admin',
}

export interface RateLimitConfig {
  tier: RateLimitTier;
  limit?: number;
  window?: number;        // seconds
  keyBy?: string[];       // request body fields for per-account rate limiting
  accountLimit?: number;  // per-account limit (overrides tier default)
  accountWindow?: number; // per-account window in seconds (overrides tier default)
  walletLimit?: number;   // per-wallet limit (overrides tier default)
  walletWindow?: number;  // per-wallet window in seconds (overrides tier default)
}

export const RateLimit = (config: RateLimitConfig) =>
  SetMetadata(RATE_LIMIT_KEY, config);