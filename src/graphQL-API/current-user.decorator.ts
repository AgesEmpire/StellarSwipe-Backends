import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

/**
 * Extracts the authenticated user from the GraphQL request context.
 *
 * Passport populates `req.user` after the JWT strategy validates the token.
 * Works for both REST (`@CurrentUser()` in HTTP controllers) and GraphQL resolvers.
 *
 * @example
 * @Query(() => GqlUserType)
 * async me(@CurrentUser() user: JwtPayload) {
 *   return this.usersService.findById(user.id);
 * }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    // GraphQL context — extract from GQL execution context
    if (ctx.getType<'graphql' | 'http'>() === 'graphql') {
      const gqlCtx = GqlExecutionContext.create(ctx);
      return gqlCtx.getContext<{ req: { user: unknown } }>().req.user;
    }

    // REST / HTTP context fallback
    const request = ctx.switchToHttp().getRequest<{ user: unknown }>();
    return request.user;
  },
);
