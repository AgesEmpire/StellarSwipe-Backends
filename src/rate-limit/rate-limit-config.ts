/**
 * Rate limit configuration for API key usage tiers.
 *
 * Defines default and burst limits for different API key tiers.
 * Tiers control how many requests an API key can make within a sliding window.
 */
export enum ApiKeyTier {
  FREE = 'free',
  STARTER = 'starter',
  BUSINESS = 'business',
  ENTERPRISE = 'enterprise',
}

export interface ApiKeyTierLimits {
  /** Base requests per window. */
  limit: number;
  /** Burst (short-term) requests per burst window. */
  burstLimit: number;
  /** Window duration in seconds for the base limit. */
  windowSeconds: number;
  /** Window duration in seconds for burst. */
  burstWindowSeconds: number;
}

/**
 * Default API key tier limits.
 * FREE:    100 req / 15 min, burst 20 / 1 min
 * STARTER: 1000 req / 15 min, burst 50 / 1 min
 * BUSINESS: 5000 req / 15 min, burst 200 / 1 min
 * ENTERPRISE: 20000 req / 15 min, burst 500 / 1 min
 */
export const API_KEY_TIER_LIMITS: Record<ApiKeyTier, ApiKeyTierLimits> = {
  [ApiKeyTier.FREE]: {
    limit: 100,
    burstLimit: 20,
    windowSeconds: 15 * 60,
    burstWindowSeconds: 60,
  },
  [ApiKeyTier.STARTER]: {
    limit: 1000,
    burstLimit: 50,
    windowSeconds: 15 * 60,
    burstWindowSeconds: 60,
  },
  [ApiKeyTier.BUSINESS]: {
    limit: 5000,
    burstLimit: 200,
    windowSeconds: 15 * 60,
    burstWindowSeconds: 60,
  },
  [ApiKeyTier.ENTERPRISE]: {
    limit: 20000,
    burstLimit: 500,
    windowSeconds: 15 * 60,
    burstWindowSeconds: 60,
  },
};

/**
 * Rate limit configuration for endpoint groups.
 * Different endpoint groups can have different rate limit policies.
 */
export enum EndpointGroup {
  DEFAULT = 'default',
  TRADES = 'trades',
  SIGNALS = 'signals',
  PORTFOLIO = 'portfolio',
  ADMIN = 'admin',
  WEBHOOKS = 'webhooks',
}

export const ENDPOINT_GROUP_PATTERNS: Record<EndpointGroup, RegExp[]> = {
  [EndpointGroup.DEFAULT]: [/.*/],
  [EndpointGroup.TRADES]: [/^\/api\/v1\/trades/, /^\/api\/v1\/orders/],
  [EndpointGroup.SIGNALS]: [/^\/api\/v1\/signals/],
  [EndpointGroup.PORTFOLIO]: [/^\/api\/v1\/portfolio/],
  [EndpointGroup.ADMIN]: [/^\/api\/v1\/admin/],
  [EndpointGroup.WEBHOOKS]: [/^\/api\/v1\/webhooks/],
};
