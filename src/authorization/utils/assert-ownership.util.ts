import { ForbiddenResourceException } from '../../common/exceptions/forbidden-resource.exception';

/** Roles that may access any account-bound resource regardless of ownership. */
export const OPERATOR_ROLES = ['admin', 'operator'];

export interface OwnershipCheckInput {
  /** ID of the account making the request. */
  requesterId: string | undefined | null;
  /** ID of the account that owns the resource being accessed. */
  ownerId: string | undefined | null;
  /** Roles held by the requester, if any. */
  requesterRoles?: string[];
  /** Label used in the error message, e.g. "portfolio", "trade". */
  resource?: string;
}

/**
 * True if `requesterId` owns the resource, or holds one of the roles allowed
 * to act as an authorized operator on any account's data.
 */
export function isOwnerOrOperator(input: Omit<OwnershipCheckInput, 'resource'>): boolean {
  if (!input.requesterId || !input.ownerId) {
    return false;
  }
  if (input.requesterId === input.ownerId) {
    return true;
  }
  return (input.requesterRoles ?? []).some((role) => OPERATOR_ROLES.includes(role));
}

/**
 * Single source of truth for "does this caller own this account-bound
 * resource, or are they an authorized operator" — used by both
 * {@link GqlOwnershipGuard} and any resolver/service that needs to check
 * ownership on a nested resource that isn't reachable via the guard's
 * declarative metadata (e.g. a resource loaded two levels deep).
 *
 * Throws {@link ForbiddenResourceException} (consistent 403 shape) rather
 * than returning a boolean, so call sites can't accidentally swallow a
 * failed check.
 */
export function assertOwnership(input: OwnershipCheckInput): void {
  if (!isOwnerOrOperator(input)) {
    throw new ForbiddenResourceException(input.resource);
  }
}
