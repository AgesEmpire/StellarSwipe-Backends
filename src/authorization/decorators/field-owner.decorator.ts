import { SetMetadata } from '@nestjs/common';

export const FIELD_OWNER_KEY = 'fieldOwnerProperty';

/**
 * Marks a GraphQL `@ResolveField()` (or `@Query()`/`@Mutation()`) as
 * account-bound: the resolved value belongs to a specific account, and only
 * that account (or an authorized operator) may read it.
 *
 * `ownerProperty` names the property on the *parent* object (the `@Parent()`
 * argument) that holds the owning account's ID — defaults to `"userId"`,
 * which covers most entities in this codebase.
 *
 * Pair with `@UseGuards(GqlOwnershipGuard)` at the resolver or field level.
 *
 * @example
 * ```ts
 * @UseGuards(GqlAuthGuard, GqlOwnershipGuard)
 * @FieldOwner()
 * @ResolveField(() => [PositionType])
 * async openPositions(@Parent() portfolio: PortfolioType) { ... }
 * ```
 */
export const FieldOwner = (ownerProperty: string = 'userId') =>
  SetMetadata(FIELD_OWNER_KEY, ownerProperty);
