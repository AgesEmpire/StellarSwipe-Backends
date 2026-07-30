import { assertOwnership, isOwnerOrOperator } from './assert-ownership.util';
import { ForbiddenResourceException } from '../../common/exceptions/forbidden-resource.exception';

describe('isOwnerOrOperator', () => {
  it('returns true when the requester owns the resource', () => {
    expect(isOwnerOrOperator({ requesterId: 'user-1', ownerId: 'user-1' })).toBe(true);
  });

  it('returns false for a cross-account request with no operator role', () => {
    expect(isOwnerOrOperator({ requesterId: 'user-1', ownerId: 'user-2' })).toBe(false);
  });

  it('returns true for an authorized operator accessing another account', () => {
    expect(
      isOwnerOrOperator({ requesterId: 'admin-1', ownerId: 'user-2', requesterRoles: ['admin'] }),
    ).toBe(true);
    expect(
      isOwnerOrOperator({ requesterId: 'ops-1', ownerId: 'user-2', requesterRoles: ['operator'] }),
    ).toBe(true);
  });

  it('returns false when requester or owner id is missing', () => {
    expect(isOwnerOrOperator({ requesterId: undefined, ownerId: 'user-2' })).toBe(false);
    expect(isOwnerOrOperator({ requesterId: 'user-1', ownerId: undefined })).toBe(false);
  });

  it('does not treat an unrelated role as authorizing cross-account access', () => {
    expect(
      isOwnerOrOperator({ requesterId: 'user-1', ownerId: 'user-2', requesterRoles: ['trader'] }),
    ).toBe(false);
  });
});

describe('assertOwnership', () => {
  it('does not throw when the requester owns the resource', () => {
    expect(() => assertOwnership({ requesterId: 'user-1', ownerId: 'user-1' })).not.toThrow();
  });

  it('throws a ForbiddenResourceException on cross-account access', () => {
    expect(() => assertOwnership({ requesterId: 'user-1', ownerId: 'user-2', resource: 'trade' })).toThrow(
      ForbiddenResourceException,
    );
  });

  it('allows an operator role to bypass the ownership check', () => {
    expect(() =>
      assertOwnership({ requesterId: 'admin-1', ownerId: 'user-2', requesterRoles: ['admin'] }),
    ).not.toThrow();
  });
});
