import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { FIELD_OWNER_KEY } from '../decorators/field-owner.decorator';
import { isOwnerOrOperator } from '../utils/assert-ownership.util';
import { ForbiddenResourceException } from '../../common/exceptions/forbidden-resource.exception';

/**
 * Enforces account-ownership on GraphQL fields marked with `@FieldOwner()`.
 *
 * This centralizes what would otherwise be a manual `if (parent.userId !==
 * user.id) throw ...` copy-pasted into every resolver that touches
 * account-bound data (portfolios, trades, nested positions, etc.) — one
 * guard, one consistent 403 response shape
 * (`ForbiddenResourceException` / code `FORBIDDEN_RESOURCE`), applied
 * declaratively.
 *
 * Fields without `@FieldOwner()` metadata are left untouched — this guard is
 * opt-in per field/resolver, not a blanket restriction.
 */
@Injectable()
export class GqlOwnershipGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const ownerProperty = this.reflector.getAllAndOverride<string | undefined>(FIELD_OWNER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!ownerProperty) {
      return true;
    }

    const gqlContext = GqlExecutionContext.create(context);
    const parent = gqlContext.getRoot<Record<string, unknown>>();
    const request = gqlContext.getContext()?.req;
    const requesterId: string | undefined = request?.user?.id;
    const requesterRoles: string[] = request?.user?.roles ?? (request?.user?.role ? [request.user.role] : []);

    const ownerId = parent ? (parent[ownerProperty] as string | undefined) : undefined;

    // No owner reference on the parent (e.g. a public/aggregate type) — nothing to check.
    if (ownerId === undefined) {
      return true;
    }

    if (!isOwnerOrOperator({ requesterId, ownerId, requesterRoles })) {
      throw new ForbiddenResourceException();
    }

    return true;
  }
}
