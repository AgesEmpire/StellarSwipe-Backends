import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { GqlExecutionContext } from '@nestjs/graphql';
import { PUBLIC_ROUTE } from '../decorators/public.decorator';

export const AUTH_STRATEGY_KEY = 'auth:strategy';
export type AuthStrategy = 'jwt' | 'api-key' | 'jwt-or-api-key';

/**
 * Unified auth guard that supports multiple authentication strategies.
 * Use @SetMetadata(AUTH_STRATEGY_KEY, 'jwt-or-api-key') to configure.
 *
 * Strategies:
 * - 'jwt': JWT Bearer token only (default)
 * - 'api-key': API key only
 * - 'jwt-or-api-key': Try JWT first, fall back to API key
 */
@Injectable()
export class UnifiedAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(UnifiedAuthGuard.name);

  constructor(private readonly reflector: Reflector) {
    super();
  }

  getRequest(context: ExecutionContext) {
    if (this.isGraphqlContext(context)) {
      const ctx = GqlExecutionContext.create(context);
      return ctx.getContext<{ req: Request }>().req;
    }
    return context.switchToHttp().getRequest();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const strategy = this.reflector.getAllAndOverride<AuthStrategy>(
      AUTH_STRATEGY_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Default to JWT for backward compatibility
    if (!strategy || strategy === 'jwt') {
      return super.canActivate(context);
    }

    if (strategy === 'jwt-or-api-key') {
      return this.tryJwtOrApiKey(context);
    }

    return super.canActivate(context);
  }

  private async tryJwtOrApiKey(context: ExecutionContext): Promise<boolean> {
    try {
      return await super.canActivate(context);
    } catch {
      // JWT failed, try API key
      const request = this.getRequest(context);
      const authHeader = request.headers?.authorization;
      if (authHeader?.startsWith('Bearer sk_live_')) {
        // Let API key guard handle it
        return true;
      }
      throw new UnauthorizedException('Authentication required');
    }
  }

  private isGraphqlContext(context: ExecutionContext): boolean {
    const type = context.getType<string>();
    return type === 'graphql';
  }

  handleRequest<TUser = any>(err: Error, user: TUser): TUser {
    if (err || !user) {
      this.logger.warn(`Auth failed: ${err?.message ?? 'no user'}`);
      throw new UnauthorizedException(err?.message ?? 'Unauthorized');
    }
    return user;
  }
}
