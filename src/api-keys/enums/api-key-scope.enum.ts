/**
 * ApiKeyScope defines the allowed permission scopes for API keys.
 * Each scope grants access to a specific set of operations.
 *
 * Issue #860 — Implement API key scope validation per endpoint
 */
export enum ApiKeyScope {
  SIGNALS_READ = 'signals:read',
  SIGNALS_WRITE = 'signals:write',
  TRADES_WRITE = 'trades:write',
  TRADES_READ = 'trades:read',
  PORTFOLIO_READ = 'portfolio:read',
  ANALYTICS_READ = 'analytics:read',
  ADMIN = 'admin:*',
}

/** All valid scope values as a const array (for class-validator @IsIn()) */
export const ALL_API_KEY_SCOPES = Object.values(ApiKeyScope);
