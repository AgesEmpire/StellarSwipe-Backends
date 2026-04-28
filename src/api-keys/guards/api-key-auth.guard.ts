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

export const API_KEY_SCOPES = 'api_key_scopes';

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

    const requiredScopes = this.reflector.get<string[]>(
      API_KEY_SCOPES,
      context.getHandler(),
    );

    if (requiredScopes?.length) {
      const hasScope = requiredScopes.some((scope) =>
        apiKey.scopes.includes(scope),
      );
      if (!hasScope) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    request.apiKey = apiKey;
    request.userId = apiKey.userId;

    const endpoint = `${request.method}:${request.path}`;
    await this.apiKeysService.trackUsage(apiKey.id, endpoint, false);

    this.logger.debug(`API key ${apiKey.id} authenticated for ${endpoint}`);

    return true;
  }
}
