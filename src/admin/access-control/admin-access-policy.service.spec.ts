import { ForbiddenException } from '@nestjs/common';
import { AdminAccessPolicyService } from './admin-access-policy.service';

describe('AdminAccessPolicyService', () => {
  const repository = {
    find: jest.fn(),
  };

  let service: AdminAccessPolicyService;

  beforeEach(() => {
    repository.find.mockReset();
    service = new AdminAccessPolicyService(repository as any);
  });

  const assignment = (
    roleName: string,
    permissions: string[],
    active = true,
  ) => ({
    isActive: () => active,
    role: {
      name: roleName,
      permissions: permissions.map((name) => ({ name, isActive: true })),
    },
  });

  it('allows an authenticated admin with the required read permission', async () => {
    repository.find.mockResolvedValue([assignment('admin', ['admin:read'])]);

    await expect(
      service.assertCanAccessAdminRoute({ id: 'admin-1' }, 'GET'),
    ).resolves.toBeUndefined();
  });

  it('allows higher admin permissions for lower-risk methods', async () => {
    repository.find.mockResolvedValue([assignment('super-admin', ['admin:admin'])]);

    await expect(
      service.assertCanAccessAdminRoute({ id: 'admin-1' }, 'DELETE'),
    ).resolves.toBeUndefined();
  });

  it('denies unauthenticated requests', async () => {
    await expect(
      service.assertCanAccessAdminRoute(undefined, 'GET'),
    ).rejects.toThrow(ForbiddenException);
    expect(repository.find).not.toHaveBeenCalled();
  });

  it('denies users without an active admin role', async () => {
    repository.find.mockResolvedValue([assignment('trader', ['admin:read'])]);

    await expect(
      service.assertCanAccessAdminRoute({ id: 'user-1' }, 'GET'),
    ).rejects.toThrow(/Administrative role required/);
  });

  it('denies admins missing the method-level permission', async () => {
    repository.find.mockResolvedValue([assignment('admin', ['admin:read'])]);

    await expect(
      service.assertCanAccessAdminRoute({ id: 'admin-1' }, 'POST'),
    ).rejects.toThrow(/admin:write/);
  });

  it('ignores expired or revoked role assignments', async () => {
    repository.find.mockResolvedValue([assignment('admin', ['admin:admin'], false)]);

    await expect(
      service.assertCanAccessAdminRoute({ id: 'admin-1' }, 'GET'),
    ).rejects.toThrow(/Administrative role required/);
  });
});
