import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ApiKeysService } from '../api-keys.service';
import { TenantContextProvider } from '../../common/tenant-context';

/**
 * Tenant-aware API key guard that validates tenant context and scopes
 */
@Injectable()
export class TenantAwareApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(TenantAwareApiKeyGuard.name);

  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer sk_live_')) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const rawKey = authHeader.substring(7);
    const apiKey = await this.apiKeysService.verify(rawKey);

    // Get tenant context from request or headers
    const tenantId =
      (request as any).tenantContext?.tenantId ||
      request.headers['x-tenant-id'] as string;

    if (!tenantId) {
      throw new ForbiddenException('Missing tenant context (x-tenant-id header)');
    }

    // Validate that API key belongs to the requested tenant
    if (apiKey.tenantId && apiKey.tenantId !== tenantId) {
      this.logger.warn(
        `Tenant mismatch: API key tenant=${apiKey.tenantId}, request tenant=${tenantId}`,
      );
      throw new ForbiddenException('API key not valid for this tenant');
    }

    // Validate scopes for the tenant
    const tenantScopePrefix = `tenant:${tenantId}:`;
    const hasValidScope = apiKey.scopes.some(
      (scope) =>
        scope === '*' || // Admin scope
        scope.startsWith(tenantScopePrefix) || // Tenant-scoped permission
        scope === `tenant:*`, // All tenants
    );

    if (!hasValidScope) {
      this.logger.warn(
        `Invalid tenant scope for API key ${apiKey.id} accessing tenant ${tenantId}`,
      );
      throw new ForbiddenException('API key has no valid scopes for this tenant');
    }

    // Check rate limit
    const allowed = await this.apiKeysService.checkRateLimit(
      apiKey.id,
      apiKey.rateLimit,
    );

    if (!allowed) {
      this.logger.warn(`Rate limit exceeded for API key ${apiKey.id}`);
      throw new ForbiddenException('Rate limit exceeded');
    }

    // Attach context to request
    request.apiKey = apiKey;
    request.userId = apiKey.userId;
    request.tenantId = tenantId;

    // Update tenant context with API key info
    if (!request.tenantContext) {
      request.tenantContext = {
        tenantId,
        userId: apiKey.userId,
        scopes: apiKey.scopes,
        isAdmin: apiKey.scopes.includes('*'),
      };
    }

    // Track usage
    const endpoint = `${request.method}:${request.path}`;
    await this.apiKeysService.trackUsage(apiKey.id, endpoint, false);

    this.logger.debug(
      `Tenant-aware API key ${apiKey.id} authenticated for tenant ${tenantId}`,
    );

    return true;
  }
}
