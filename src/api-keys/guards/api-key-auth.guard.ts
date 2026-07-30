import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeysService } from '../api-keys.service';
import { API_KEY_SCOPES_METADATA } from '../decorators/require-scopes.decorator';

/**
 * @deprecated For scope-based access control, prefer using ApiKeyScopesGuard
 * together with the @RequireScopes() decorator. This guard handles authentication
 * (key validation + rate limiting) only.
 */
export const API_KEY_SCOPES = API_KEY_SCOPES_METADATA;

/**
 * Supported sources for API key extraction, in priority order:
 * 1. Authorization header (`Bearer sk_live_xxx`)
 * 2. X-API-Key header
 * 3. `api_key` query parameter
 */
export const API_KEY_HEADER = 'x-api-key';
export const API_KEY_QUERY_PARAM = 'api_key';
export const API_KEY_PREFIX = 'Bearer sk_live_';

/** Metadata key for the API key auth guard */
export const API_KEY_AUTH_METADATA = 'api_key_auth';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyAuthGuard.name);

  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey = this.extractApiKey(request);

    if (!rawKey) {
      throw new UnauthorizedException(
        'API key is required. Provide it via Authorization header (Bearer sk_live_xxx), ' +
        `X-API-Key header, or ${API_KEY_QUERY_PARAM} query parameter.`,
      );
    }

    const apiKey = await this.apiKeysService.verify(rawKey);

    const allowed = await this.apiKeysService.checkRateLimit(
      apiKey.id,
      apiKey.rateLimit,
    );

    if (!allowed) {
      this.logger.warn(`Rate limit exceeded for API key ${apiKey.id}`);
      throw new ForbiddenException('Rate limit exceeded');
    }

    // Attach the key to the request so ApiKeyScopesGuard and downstream can read it.
    request.apiKey = apiKey;
    request.userId = apiKey.userId;

    const endpoint = `${request.method}:${request.path}`;
    await this.apiKeysService.trackUsage(apiKey.id, endpoint, false);

    this.logger.debug(`API key ${apiKey.id} authenticated for ${endpoint}`);

    return true;
  }

  /**
   * Extract the raw API key from the request in priority order:
   * 1. Authorization header (Bearer sk_live_xxx)
   * 2. X-API-Key header
   * 3. `api_key` query parameter
   */
  extractApiKey(request: any): string | null {
    // 1. Check Authorization header
    const authHeader = request.headers?.authorization;
    if (authHeader?.startsWith(API_KEY_PREFIX)) {
      return authHeader.substring(API_KEY_PREFIX.length).trim();
    }

    // 2. Check X-API-Key header
    const apiKeyHeader = request.headers?.[API_KEY_HEADER];
    if (apiKeyHeader && typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
      return apiKeyHeader.trim();
    }

    // 3. Check `api_key` query parameter
    const queryKey = request.query?.[API_KEY_QUERY_PARAM];
    if (queryKey && typeof queryKey === 'string' && queryKey.length > 0) {
      return queryKey.trim();
    }

    return null;
  }
}
