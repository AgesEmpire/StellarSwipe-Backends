import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Reflector } from '@nestjs/core';
import { PUBLIC_ROUTE } from '../../common/decorators/public.decorator';

@Injectable()
export class GqlAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(GqlAuthGuard.name);

  constructor(private readonly reflector: Reflector) {
    super();
  }

  /** Expose the HTTP request from the GQL context so Passport can read it. */
  getRequest(context: ExecutionContext) {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext<{ req: Request }>().req;
  }

  canActivate(context: ExecutionContext) {
    // Allow routes decorated with @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const gqlContext = GqlExecutionContext.create(context).getContext<{
      req?: Request;
      user?: unknown;
    }>();

    // Subscriptions delivered over `graphql-ws` have no HTTP `req` — that
    // shape only exists for query/mutation operations that go through the
    // Apollo HTTP `context` factory. WS connections are authenticated once,
    // at handshake time, in `GraphqlModule`'s `subscriptions['graphql-ws']`
    // `onConnect` hook, which stashes the verified user on the per-operation
    // context as `context.user`. Here we just enforce that it's present,
    // instead of (incorrectly) trying to run the Passport `jwt` strategy
    // again against a request object that doesn't exist for this transport.
    if (!gqlContext.req) {
      if (!gqlContext.user) {
        this.logger.warn('GQL subscription auth failed: no authenticated user on WS context');
        throw new UnauthorizedException('Unauthorized');
      }
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = any>(err: Error, user: TUser): TUser {
    if (err || !user) {
      this.logger.warn(`GQL auth failed: ${err?.message ?? 'no user'}`);
      throw new UnauthorizedException(err?.message ?? 'Unauthorized');
    }
    return user;
  }
}
