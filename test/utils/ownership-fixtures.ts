export interface OwnershipActor {
  id: string;
  roles?: string[];
}

export interface OwnershipFixture<T> {
  owner: OwnershipActor;
  otherUser: OwnershipActor;
  admin: OwnershipActor;
  resource: T;
  nested: { owner: T };
  batch: T[];
}

export function ownershipFixtureFactory<T extends Record<string, unknown>>(
  resource: T,
  ownerId = 'tenant-owner',
): OwnershipFixture<T> {
  const owner = { id: ownerId };
  const otherUser = { id: 'tenant-other' };
  const admin = { id: 'tenant-admin', roles: ['admin'] };
  const otherResource = {
    ...resource,
    id: `${String(resource.id)}-other`,
    ...(resource.userId !== undefined ? { userId: otherUser.id } : {}),
    ...(resource.providerId !== undefined ? { providerId: otherUser.id } : {}),
  } as T;

  return {
    owner,
    otherUser,
    admin,
    resource,
    nested: { owner: resource },
    batch: [resource, otherResource],
  };
}

export const protectedResourceFixtures = {
  order: ownershipFixtureFactory({ id: 'order-1', userId: 'tenant-owner' }),
  position: ownershipFixtureFactory({ id: 'position-1', userId: 'tenant-owner' }),
  signal: ownershipFixtureFactory({ id: 'signal-1', providerId: 'tenant-owner' }),
  audit: ownershipFixtureFactory({ id: 'audit-1', userId: 'tenant-owner' }),
};

export function ownerIdOf(resource: Record<string, unknown>): string | undefined {
  return (resource.userId ?? resource.providerId) as string | undefined;
}
