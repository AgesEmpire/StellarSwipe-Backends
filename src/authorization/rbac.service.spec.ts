import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RbacService } from './rbac.service';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { UserRole } from './entities/user-role.entity';
import { ApprovalWorkflow, ApprovalRequest, ApprovalAction } from './entities/approval-workflow.entity';
import { PermissionChecker } from './utils/permission-checker';
import { PolicyEvaluator } from './utils/policy-evaluator';
import { PermissionAuditService } from '../auth/permission-audit.service';

describe('RbacService', () => {
  let service: RbacService;
  let roleRepository: Repository<Role>;
  let permissionRepository: Repository<Permission>;
  let userRoleRepository: Repository<UserRole>;
  let workflowRepository: Repository<ApprovalWorkflow>;
  let requestRepository: Repository<ApprovalRequest>;
  let actionRepository: Repository<ApprovalAction>;

  const mockRoleRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    })),
  };

  const mockPermissionRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findByIds: jest.fn(),
    find: jest.fn(),
  };

  const mockUserRoleRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const mockWorkflowRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    })),
  };

  const mockRequestRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  const mockActionRepository = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockPermissionChecker = {
    checkUserHasAnyPermission: jest.fn(),
    checkUserHasAllPermissions: jest.fn(),
    checkPermissions: jest.fn(),
  };

  const mockPolicyEvaluator = {
    evaluateAccessRequest: jest.fn(),
  };

  const mockPermissionAuditService = {
    log: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        {
          provide: getRepositoryToken(Role),
          useValue: mockRoleRepository,
        },
        {
          provide: getRepositoryToken(Permission),
          useValue: mockPermissionRepository,
        },
        {
          provide: getRepositoryToken(UserRole),
          useValue: mockUserRoleRepository,
        },
        {
          provide: getRepositoryToken(ApprovalWorkflow),
          useValue: mockWorkflowRepository,
        },
        {
          provide: getRepositoryToken(ApprovalRequest),
          useValue: mockRequestRepository,
        },
        {
          provide: getRepositoryToken(ApprovalAction),
          useValue: mockActionRepository,
        },
        {
          provide: PermissionChecker,
          useValue: mockPermissionChecker,
        },
        {
          provide: PolicyEvaluator,
          useValue: mockPolicyEvaluator,
        },
        {
          provide: PermissionAuditService,
          useValue: mockPermissionAuditService,
        },
        {
          provide: 'DataSource',
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<RbacService>(RbacService);
    roleRepository = module.get<Repository<Role>>(getRepositoryToken(Role));
    permissionRepository = module.get<Repository<Permission>>(getRepositoryToken(Permission));
    userRoleRepository = module.get<Repository<UserRole>>(getRepositoryToken(UserRole));
    workflowRepository = module.get<Repository<ApprovalWorkflow>>(getRepositoryToken(ApprovalWorkflow));
    requestRepository = module.get<Repository<ApprovalRequest>>(getRepositoryToken(ApprovalRequest));
    actionRepository = module.get<Repository<ApprovalAction>>(getRepositoryToken(ApprovalAction));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createRole', () => {
    it('should create a role successfully', async () => {
      const createRoleDto = {
        name: 'Test Role',
        description: 'A test role',
        permissionIds: ['perm1', 'perm2'],
      };
      const createdBy = 'user1';
      const mockRole = { id: 'role1', ...createRoleDto };
      const mockPermissions = [
        { id: 'perm1', name: 'permission1' },
        { id: 'perm2', name: 'permission2' },
      ];

      mockRoleRepository.create.mockReturnValue(mockRole);
      mockPermissionRepository.findByIds.mockResolvedValue(mockPermissions);
      mockRoleRepository.save.mockResolvedValue(mockRole);

      const result = await service.createRole(createRoleDto, createdBy);

      expect(result).toEqual(mockRole);
      expect(mockRoleRepository.create).toHaveBeenCalledWith({
        ...createRoleDto,
        createdBy,
      });
      expect(mockPermissionRepository.findByIds).toHaveBeenCalledWith(createRoleDto.permissionIds);
      expect(mockRoleRepository.save).toHaveBeenCalledWith(mockRole);
    });
  });

  describe('assignRoleToUser', () => {
    it('should assign role to user successfully', async () => {
      const userId = 'user1';
      const roleId = 'role1';
      const assignedBy = 'admin1';
      const mockRole = { id: roleId, name: 'Test Role' };
      const mockUserRole = {
        id: 'userRole1',
        userId,
        roleId,
        assignedBy,
        status: 'active',
      };

      mockRoleRepository.findOne.mockResolvedValue(mockRole);
      mockUserRoleRepository.create.mockReturnValue(mockUserRole);
      mockUserRoleRepository.save.mockResolvedValue(mockUserRole);

      const result = await service.assignRoleToUser(userId, roleId, assignedBy);

      expect(result).toEqual(mockUserRole);
      expect(mockRoleRepository.findOne).toHaveBeenCalledWith({ where: { id: roleId } });
      expect(mockUserRoleRepository.create).toHaveBeenCalledWith({
        userId,
        roleId,
        assignedBy,
        teamId: undefined,
        organizationId: undefined,
        expiresAt: undefined,
      });
      expect(mockUserRoleRepository.save).toHaveBeenCalledWith(mockUserRole);
    });

    it('should throw NotFoundException if role not found', async () => {
      const userId = 'user1';
      const roleId = 'role1';
      const assignedBy = 'admin1';

      mockRoleRepository.findOne.mockResolvedValue(null);

      await expect(service.assignRoleToUser(userId, roleId, assignedBy)).rejects.toThrow(
        'Role not found'
      );
    });
  });

  describe('checkUserPermissions', () => {
    it('should check user permissions', async () => {
      const userId = 'user1';
      const permissions = ['read:users', 'write:users'];
      const context = { resource: 'users' };
      const expectedResult = true;

      mockPermissionChecker.checkUserHasAnyPermission.mockResolvedValue(expectedResult);

      const result = await service.checkUserPermissions(userId, permissions, context);

      expect(result).toEqual(expectedResult);
      expect(mockPermissionChecker.checkUserHasAnyPermission).toHaveBeenCalledWith(
        userId,
        permissions,
        context
      );
    });
  });

  describe('createWorkflow', () => {
    it('should create workflow successfully', async () => {
      const createWorkflowDto = {
        name: 'Test Workflow',
        type: 'role_assignment' as any,
        steps: [],
      };
      const createdBy = 'user1';
      const mockWorkflow = { id: 'workflow1', ...createWorkflowDto };

      mockWorkflowRepository.create.mockReturnValue(mockWorkflow);
      mockWorkflowRepository.save.mockResolvedValue(mockWorkflow);

      const result = await service.createWorkflow(createWorkflowDto, createdBy);

      expect(result).toEqual(mockWorkflow);
      expect(mockWorkflowRepository.create).toHaveBeenCalledWith({
        ...createWorkflowDto,
        createdBy,
      });
      expect(mockWorkflowRepository.save).toHaveBeenCalledWith(mockWorkflow);
    });
  });

  describe('createAccessRequest', () => {
    it('should create access request successfully', async () => {
      const createRequestDto = {
        workflowId: 'workflow1',
        title: 'Test Request',
        description: 'A test request',
        requestData: { action: 'create' },
      };
      const requesterId = 'user1';
      const mockWorkflow = {
        id: 'workflow1',
        timeoutHours: 24,
        steps: [],
      };
      const mockRequest = {
        id: 'request1',
        ...createRequestDto,
        requesterId,
        status: 'pending',
      };

      mockWorkflowRepository.findOne.mockResolvedValue(mockWorkflow);
      mockRequestRepository.create.mockReturnValue(mockRequest);
      mockRequestRepository.save.mockResolvedValue(mockRequest);

      const result = await service.createAccessRequest(createRequestDto, requesterId);

      expect(result).toEqual(mockRequest);
      expect(mockWorkflowRepository.findOne).toHaveBeenCalledWith({
        where: { id: createRequestDto.workflowId },
        relations: ['steps'],
      });
      expect(mockRequestRepository.create).toHaveBeenCalled();
      expect(mockRequestRepository.save).toHaveBeenCalledWith(mockRequest);
    });

    it('should throw NotFoundException if workflow not found', async () => {
      const createRequestDto = {
        workflowId: 'workflow1',
        title: 'Test Request',
        requestData: {},
      };
      const requesterId = 'user1';

      mockWorkflowRepository.findOne.mockResolvedValue(null);

      await expect(service.createAccessRequest(createRequestDto, requesterId)).rejects.toThrow(
        'Workflow not found'
      );
    });
  });
});