import { ForbiddenResourceException } from '../common/exceptions/forbidden-resource.exception';
import { assertOwnership } from './utils/assert-ownership.util';
import {
  ownerIdOf,
  protectedResourceFixtures,
  OwnershipActor,
} from '../../test/utils/ownership-fixtures';

type ProtectedResource = keyof typeof protectedResourceFixtures;

function checkResource(resourceType: ProtectedResource, actor: OwnershipActor, resource: Record<string, unknown>): void {
  assertOwnership({
    requesterId: actor.id,
    ownerId: ownerIdOf(resource),
    requesterRoles: actor.roles,
    resource: resourceType,
  });
}

describe('account ownership matrix', () => {
  for (const [resourceType, fixture] of Object.entries(protectedResourceFixtures) as [ProtectedResource, (typeof protectedResourceFixtures)[ProtectedResource]][]) {
    describe(resourceType, () => {
      it('rejects direct cross-tenant access', () => {
        expect(() => checkResource(resourceType, fixture.otherUser, fixture.resource)).toThrow(
          ForbiddenResourceException,
        );
      });

      it('rejects cross-tenant access through a nested relation', () => {
        expect(() => checkResource(resourceType, fixture.otherUser, fixture.nested.owner)).toThrow(
          ForbiddenResourceException,
        );
      });

      it('rejects a batch containing another tenant resource', () => {
        expect(() => fixture.batch.forEach((resource) => checkResource(resourceType, fixture.owner, resource))).toThrow(
          ForbiddenResourceException,
        );
      });

      it('allows the owning account', () => {
        expect(() => checkResource(resourceType, fixture.owner, fixture.resource)).not.toThrow();
      });

      it('allows an admin exception', () => {
        expect(() => checkResource(resourceType, fixture.admin, fixture.resource)).not.toThrow();
      });
    });
  }
});
