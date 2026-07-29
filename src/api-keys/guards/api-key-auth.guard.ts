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

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyAuthGuard.name);

  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer sk_live_')) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const rawKey = authHeader.substring(7);
    const apiKey = await this.apiKeysService.verify(rawKey);

    const allowed = await this.apiKeysService.checkRateLimit(
      apiKey.id,
      apiKey.rateLimit,
    );

    if (!allowed) {
      this.logger.warn(`Rate limit exceeded for API key ${apiKey.id}`);
      throw new ForbiddenException('Rate limit exceeded');
    }

    // Attach the key to the request so ApiKeyScopesGuard can read it.
    request.apiKey = apiKey;
    request.userId = apiKey.userId;

    const endpoint = `${request.method}:${request.path}`;
    await this.apiKeysService.trackUsage(apiKey.id, endpoint, false);

    this.logger.debug(`API key ${apiKey.id} authenticated for ${endpoint}`);

    return true;
  }
}
