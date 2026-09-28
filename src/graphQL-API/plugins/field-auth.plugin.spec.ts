import { Test, TestingModule } from '@nestjs/testing';
import { FieldAuthorizationPlugin, FieldAuthExtension } from './field-auth.plugin';
import { PermissionChecker } from '../../authorization/utils/permission-checker';

describe('FieldAuthorizationPlugin', () => {
  let plugin: FieldAuthorizationPlugin;
  let permissionChecker: PermissionChecker;

  const mockPermissionChecker = {
    checkPermissions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FieldAuthorizationPlugin,
        { provide: PermissionChecker, useValue: mockPermissionChecker },
      ],
    }).compile();

    plugin = module.get<FieldAuthorizationPlugin>(FieldAuthorizationPlugin);
    permissionChecker = module.get(PermissionChecker);
    jest.clearAllMocks();
  });

  describe('willResolveField', () => {
    it('should allow access when user has required role', async () => {
      const fieldAuth: FieldAuthExtension = { roles: ['admin'] };
      const mockInfo = {
        fieldName: 'sensitiveField',
        parentType: { name: 'UserType' },
        fieldNode: { extensions: { 'graphql:field:authorization': fieldAuth } },
      };
      const mockContext: any = { req: { user: { id: '123', roles: ['admin'] } } };

      const listener = await plugin.requestDidStart({} as any);
      if (listener?.willResolveField) {
        const result = await listener.willResolveField({ info: mockInfo, context: mockContext });
        expect(result).toBeUndefined(); // No null returned
      }
    });

    it('should deny access when user lacks required role', async () => {
      const fieldAuth: FieldAuthExtension = { roles: ['admin'] };
      const mockInfo = {
        fieldName: 'sensitiveField',
        parentType: { name: 'UserType' },
        fieldNode: { extensions: { 'graphql:field:authorization': fieldAuth } },
      };
      const mockContext: any = { req: { user: { id: '123', roles: ['user'] } } };

      // Mock permission checker to return denied
      mockPermissionChecker.checkPermissions.mockResolvedValue({
        hasPermission: false,
        grantedPermissions: [],
        deniedPermissions: ['admin'],
      });

      const listener = await plugin.requestDidStart({} as any);
      if (listener?.willResolveField) {
        const result = await listener.willResolveField({ info: mockInfo, context: mockContext });
        expect(result).toBeNull();
      }
    });

    it('should allow access when user has required permission', async () => {
      const fieldAuth: FieldAuthExtension = { permissions: ['users:read'] };
      const mockInfo = {
        fieldName: 'sensitiveField',
        parentType: { name: 'UserType' },
        fieldNode: { extensions: { 'graphql:field:authorization': fieldAuth } },
      };
      const mockContext: any = { req: { user: { id: '123', roles: [] } } };

      mockPermissionChecker.checkPermissions.mockResolvedValue({
        hasPermission: true,
        grantedPermissions: ['users:read'],
        deniedPermissions: [],
      });

      const listener = await plugin.requestDidStart({} as any);
      if (listener?.willResolveField) {
        const result = await listener.willResolveField({ info: mockInfo, context: mockContext });
        expect(result).toBeUndefined();
      }
    });

    it('should deny access when user lacks required permission', async () => {
      const fieldAuth: FieldAuthExtension = { permissions: ['users:read'] };
      const mockInfo = {
        fieldName: 'sensitiveField',
        parentType: { name: 'UserType' },
        fieldNode: { extensions: { 'graphql:field:authorization': fieldAuth } },
      };
      const mockContext: any = { req: { user: { id: '123', roles: [] } } };

      mockPermissionChecker.checkPermissions.mockResolvedValue({
        hasPermission: false,
        grantedPermissions: [],
        deniedPermissions: ['users:read'],
      });

      const listener = await plugin.requestDidStart({} as any);
      if (listener?.willResolveField) {
        const result = await listener.willResolveField({ info: mockInfo, context: mockContext });
        expect(result).toBeNull();
      }
    });

    it('should allow access when requiredAll permissions are all present', async () => {
      const fieldAuth: FieldAuthExtension = { permissions: ['users:read', 'users:write'], requireAll: true };
      const mockInfo = {
        fieldName: 'sensitiveField',
        parentType: { name: 'UserType' },
        fieldNode: { extensions: { 'graphql:field:authorization': fieldAuth } },
      };
      const mockContext: any = { req: { user: { id: '123', roles: [] } } };

      mockPermissionChecker.checkPermissions.mockResolvedValue({
        hasPermission: true,
        grantedPermissions: ['users:read', 'users:write'],
        deniedPermissions: [],
      });

      const listener = await plugin.requestDidStart({} as any);
      if (listener?.willResolveField) {
        const result = await listener.willResolveField({ info: mockInfo, context: mockContext });
        expect(result).toBeUndefined();
      }
    });

    it('should deny access when requireAll permissions are not all present', async () => {
      const fieldAuth: FieldAuthExtension = { permissions: ['users:read', 'users:write'], requireAll: true };
      const mockInfo = {
        fieldName: 'sensitiveField',
        parentType: { name: 'UserType' },
        fieldNode: { extensions: { 'graphql:field:authorization': fieldAuth } },
      };
      const mockContext: any = { req: { user: { id: '123', roles: [] } } };

      mockPermissionChecker.checkPermissions.mockResolvedValue({
        hasPermission: false, // Not all permissions granted
        grantedPermissions: ['users:read'],
        deniedPermissions: ['users:write'],
      });

      const listener = await plugin.requestDidStart({} as any);
      if (listener?.willResolveField) {
        const result = await listener.willResolveField({ info: mockInfo, context: mockContext });
        expect(result).toBeNull();
      }
    });

    it('should skip check when no user is present', async () => {
      const fieldAuth: FieldAuthExtension = { permissions: ['users:read'] };
      const mockInfo = {
        fieldName: 'sensitiveField',
        parentType: { name: 'UserType' },
        fieldNode: { extensions: { 'graphql:field:authorization': fieldAuth } },
      };
      const mockContext: any = { req: {} }; // No user

      const listener = await plugin.requestDidStart({} as any);
      if (listener?.willResolveField) {
        const result = await listener.willResolveField({ info: mockInfo, context: mockContext });
        expect(result).toBeUndefined();
        expect(mockPermissionChecker.checkPermissions).not.toHaveBeenCalled();
      }
    });
  });
});