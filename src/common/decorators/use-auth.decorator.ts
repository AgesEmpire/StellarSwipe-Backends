import { SetMetadata } from '@nestjs/common';
import { AUTH_STRATEGY_KEY, AuthStrategy } from '../guards/unified-auth.guard';

/**
 * Decorator to set the authentication strategy for a route.
 * @example
 * @UseAuth('jwt-or-api-key')
 * @Get('health')
 * healthCheck() { ... }
 */
export const UseAuth = (strategy: AuthStrategy) =>
  SetMetadata(AUTH_STRATEGY_KEY, strategy);
