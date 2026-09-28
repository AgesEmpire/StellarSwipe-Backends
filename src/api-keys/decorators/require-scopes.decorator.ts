import { SetMetadata } from '@nestjs/common';
import { ApiKeyScope } from '../enums/api-key-scope.enum';

export const API_KEY_SCOPES_METADATA = 'api_key_scopes';

/**
 * Attaches the required API key scopes to a route handler.
 * Use alongside ApiKeyScopesGuard to enforce scope-based access control.
 *
 * @example
 * \@RequireScopes(ApiKeyScope.TRADES_WRITE)
 * \@Post('execute')
 * async executeTrade() { ... }
 *
 * Issue #860 — Implement API key scope validation per endpoint
 */
export const RequireScopes = (...scopes: ApiKeyScope[]) =>
  SetMetadata(API_KEY_SCOPES_METADATA, scopes);
