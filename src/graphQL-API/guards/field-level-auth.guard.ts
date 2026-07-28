import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';

export const FIELD_ROLES_KEY = 'fieldRoles';

/**
 * Restricts a GraphQL field resolver to callers holding one of the given roles.
 * Usage: @UseGuards(FieldLevelAuthGuard) @FieldRoles('admin') on a @ResolveField().
 */
export const FieldRoles = (...roles: string[]) =>
  SetMetadata(FIELD_ROLES_KEY, roles);

@Injectable()
export class FieldLevelAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      FIELD_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const gqlContext = GqlExecutionContext.create(context);
    const request = gqlContext.getContext().req;
    const userRoles: string[] = request?.user?.roles ?? [];

    const isAuthorized = requiredRoles.some((role) =>
      userRoles.includes(role),
    );

    if (!isAuthorized) {
      throw new ForbiddenException(
        `Field access denied: requires one of roles [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}
