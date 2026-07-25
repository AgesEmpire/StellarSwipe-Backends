import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeysService } from '../api-keys.service';
import { ApiKeyScope } from '../enums/api-key-scope.enum';
import { API_KEY_SCOPES_METADATA } from '../decorators/require-scopes.decorator';

/**
 * ApiKeyScopesGuard validates that the authenticated API key has all required
 * scopes for the route decorated with @RequireScopes().
 *
 * Usage:
 *   1. Attach @UseGuards(ApiKeyAuthGuard, ApiKeyScopesGuard) to the controller or route.
 *   2. Decorate the route with @RequireScopes(ApiKeyScope.TRADES_WRITE).
 *
 * The guard reads the API key attached to request.apiKey by ApiKeyAuthGuard.
 * It supports a wildcard admin scope (ApiKeyScope.ADMIN = 'admin:*') that grants
 * access to all endpoints regardless of other scope requirements.
 *
 * Issue #860 — Implement API key scope validation per endpoint
 */
@Injectable()
export class ApiKeyScopesGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyScopesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredScopes = this.reflector.getAllAndOverride<ApiKeyScope[]>(
      API_KEY_SCOPES_METADATA,
      [context.getHandler(), context.getClass()],
    );

    // No scope requirement on this route — allow through.
    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const apiKey = request.apiKey;

    if (!apiKey) {
      throw new UnauthorizedException(
        'API key is required to access this endpoint. ' +
          'Provide a valid key in the Authorization header.',
      );
    }

    const grantedScopes: string[] = apiKey.scopes ?? [];

    // Admin wildcard grants access to everything.
    if (grantedScopes.includes(ApiKeyScope.ADMIN)) {
      this.logger.debug(
        `API key ${apiKey.id} granted access via admin wildcard scope`,
      );
      return true;
    }

    // Every required scope must be present in the key's granted scopes.
    const missingScopes = requiredScopes.filter(
      (scope) => !grantedScopes.includes(scope),
    );

    if (missingScopes.length > 0) {
      this.logger.warn(
        `API key ${apiKey.id} denied: missing scopes [${missingScopes.join(', ')}]`,
      );
      throw new ForbiddenException(
        `API key is missing required scopes: ${missingScopes.join(', ')}. ` +
          `Granted scopes: ${grantedScopes.join(', ') || 'none'}`,
      );
    }

    this.logger.debug(
      `API key ${apiKey.id} passed scope validation for [${requiredScopes.join(', ')}]`,
    );
    return true;
  }
}
