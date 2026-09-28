import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { UserRole, AssignmentStatus } from './entities/user-role.entity';
import { ApprovalWorkflow, ApprovalRequest, ApprovalAction, WorkflowType, ApprovalStatus } from './entities/approval-workflow.entity';
import { PermissionChecker } from './utils/permission-checker';
import { PolicyEvaluator } from './utils/policy-evaluator';
import { CreateRoleDto, UpdateRoleDto } from './dto/create-role.dto';
import { AssignPermissionDto, CheckPermissionDto } from './dto/assign-permission.dto';
import { CreateWorkflowDto, UpdateWorkflowDto } from './dto/workflow-config.dto';
import { CreateAccessRequestDto, ApproveRequestDto, RejectRequestDto } from './dto/access-request.dto';
import { IPermissionContext } from './interfaces/permission.interface';
import { PermissionAuditService, AuditAction, diffObjects } from '../auth/permission-audit.service';
import { PermissionMatrixService } from './permission-matrix.service';

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
    @InjectRepository(UserRole)
    private userRoleRepository: Repository<UserRole>,
    @InjectRepository(ApprovalWorkflow)
    private workflowRepository: Repository<ApprovalWorkflow>,
    @InjectRepository(ApprovalRequest)
    private requestRepository: Repository<ApprovalRequest>,
    @InjectRepository(ApprovalAction)
    private actionRepository: Repository<ApprovalAction>,
    private permissionChecker: PermissionChecker,
    private policyEvaluator: PolicyEvaluator,
    private dataSource: DataSource,
    private permissionAuditService: PermissionAuditService,
    private permissionMatrixService: PermissionMatrixService,
  ) {}

  /**
   * Guards role/permission writes against `PERMISSION_MATRIX`
   * (docs/PERMISSION_MATRIX.md) for admin/support/service_account roles.
   */
  private enforcePermissionMatrix(roleName: string, permissions: Permission[]): void {
    const violations = this.permissionMatrixService.findViolations(roleName, permissions);
    if (violations.length > 0) {
      throw new BadRequestException(
        `Permission matrix violation for role "${roleName}": ${violations
          .map(
            (v) =>
              `${v.permissionName} (${v.category}) requires "${v.requiredLevel}" but the matrix caps this archetype at "${v.maxAllowedLevel ?? 'none'}"`,
          )
          .join('; ')}`,
      );
    }
  }

  // Role Management
  async createRole(dto: CreateRoleDto, createdBy: string): Promise<Role> {
    const role = this.roleRepository.create({
      ...dto,
      createdBy,
    });

    if (dto.permissionIds?.length) {
      const permissions = await this.permissionRepository.findByIds(dto.permissionIds);
      if (dto.name) {
        this.enforcePermissionMatrix(dto.name, permissions);
      }
      role.permissions = permissions;
    }

    const saved = await this.roleRepository.save(role);
    await this.permissionAuditService.log({
      actorId: createdBy,
      action: AuditAction.ROLE_CREATED,
      resourceName: saved.name,
      metadata: { roleId: saved.id, permissionIds: dto.permissionIds },
    });
    return saved;
  }

  async updateRole(id: string, dto: UpdateRoleDto, updatedBy?: string): Promise<Role> {
    const role = await this.roleRepository.findOne({
      where: { id },
      relations: ['permissions'],
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    // Capture before state for diffing
    const beforeSnapshot: Record<string, unknown> = {
      name: role.name,
      description: role.description,
      type: role.type,
      scope: role.scope,
      isActive: role.isActive,
      priority: role.priority,
      permissionIds: role.permissions?.map((p) => p.id) ?? [],
    };

    Object.assign(role, dto);

    if (dto.permissionIds) {
      const permissions = await this.permissionRepository.findByIds(dto.permissionIds);
      this.enforcePermissionMatrix(role.name, permissions);
      role.permissions = permissions;
    }

    const saved = await this.roleRepository.save(role);

    if (updatedBy) {
      const afterSnapshot: Record<string, unknown> = {
        name: saved.name,
        description: saved.description,
        type: saved.type,
        scope: saved.scope,
        isActive: saved.isActive,
        priority: saved.priority,
        permissionIds: saved.permissions?.map((p) => p.id) ?? [],
      };

      const diff = diffObjects(beforeSnapshot, afterSnapshot);
      if (diff) {
        await this.permissionAuditService.log({
          actorId: updatedBy,
          action: AuditAction.ROLE_UPDATED,
          resourceName: saved.name,
          beforeState: diff.before,
          afterState: diff.after,
          metadata: { roleId: id },
        });
      }
    }
    return saved;
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.roleRepository.findOne({
      where: { id },
      relations: ['userRoles'],
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (role.userRoles?.length > 0) {
      throw new BadRequestException('Cannot delete role with active assignments');
    }

    await this.roleRepository.remove(role);
    await this.permissionAuditService.log({
      actorId: 'system',
      action: AuditAction.ROLE_DELETED,
      resourceName: role.name,
      metadata: { roleId: id },
    });
  }

  async getRole(id: string): Promise<Role> {
    const role = await this.roleRepository.findOne({
      where: { id },
      relations: ['permissions'],
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return role;
  }

  async getRoles(filters?: { teamId?: string; organizationId?: string }): Promise<Role[]> {
    const query = this.roleRepository
      .createQueryBuilder('role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('role.isActive = :isActive', { isActive: true });

    if (filters?.teamId) {
      query.andWhere('role.teamId = :teamId', { teamId: filters.teamId });
    }

    if (filters?.organizationId) {
      query.andWhere('role.organizationId = :organizationId', { organizationId: filters.organizationId });
    }

    return query.getMany();
  }

  // Permission Management
  async createPermission(name: string, displayName: string, category: string, level: string): Promise<Permission> {
    const permission = this.permissionRepository.create({
      name,
      displayName,
      category: category as any,
      level: level as any,
    });

    return this.permissionRepository.save(permission);
  }

  async assignPermissionsToRole(dto: AssignPermissionDto, actorId?: string): Promise<Role> {
    const role = await this.roleRepository.findOne({
      where: { id: dto.roleId },
      relations: ['permissions'],
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    const previousPermissionIds = role.permissions?.map((p) => p.id) ?? [];

    const permissions = await this.permissionRepository.findByIds(dto.permissionIds);
    this.enforcePermissionMatrix(role.name, permissions);
    role.permissions = permissions;

    const saved = await this.roleRepository.save(role);

    if (actorId) {
      const diff = diffObjects(
        { permissionIds: previousPermissionIds },
        { permissionIds: dto.permissionIds },
      );
      if (diff) {
        await this.permissionAuditService.log({
          actorId,
          action: AuditAction.PERMISSION_GRANTED,
          resourceName: role.name,
          beforeState: diff.before,
          afterState: diff.after,
          metadata: { roleId: dto.roleId },
        });
      }
    }
    return saved;
  }

  async getPermissions(): Promise<Permission[]> {
    return this.permissionRepository.find({
      where: { isActive: true },
      order: { category: 'ASC', name: 'ASC' },
    });
  }

  // User Role Assignment
  async assignRoleToUser(
    userId: string,
    roleId: string,
    assignedBy: string,
    options?: {
      teamId?: string;
      organizationId?: string;
      expiresAt?: Date;
    }
  ): Promise<UserRole> {
    const role = await this.roleRepository.findOne({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    // Capture the user's active role set before the change for diffing (issue #820)
    const beforeRoleIds = await this.getActiveRoleIds(userId);

    const userRole = this.userRoleRepository.create({
      userId,
      roleId,
      assignedBy,
      teamId: options?.teamId,
      organizationId: options?.organizationId,
      expiresAt: options?.expiresAt,
    });

    const saved = await this.userRoleRepository.save(userRole);

    const afterRoleIds = await this.getActiveRoleIds(userId);
    const diff = diffObjects({ roleIds: beforeRoleIds }, { roleIds: afterRoleIds });
    if (diff) {
      await this.permissionAuditService.log({
        actorId: assignedBy,
        targetUserId: userId,
        action: AuditAction.ROLE_ASSIGNED,
        resourceName: role.name,
        beforeState: diff.before,
        afterState: diff.after,
        metadata: { roleId, teamId: options?.teamId, organizationId: options?.organizationId },
      });
    }
    return saved;
  }

  async revokeRoleFromUser(userId: string, roleId: string, revokedBy?: string): Promise<void> {
    const userRole = await this.userRoleRepository.findOne({
      where: { userId, roleId },
    });

    if (!userRole) {
      throw new NotFoundException('Role assignment not found');
    }

    // Capture the user's active role set before the change for diffing (issue #820)
    const beforeRoleIds = await this.getActiveRoleIds(userId);

    userRole.status = 'revoked' as any;
    await this.userRoleRepository.save(userRole);

    const afterRoleIds = await this.getActiveRoleIds(userId);
    const role = await this.roleRepository.findOne({ where: { id: roleId } });

    const diff = diffObjects({ roleIds: beforeRoleIds }, { roleIds: afterRoleIds });
    if (diff) {
      await this.permissionAuditService.log({
        actorId: revokedBy ?? 'system',
        targetUserId: userId,
        action: AuditAction.ROLE_REVOKED,
        resourceName: role?.name ?? roleId,
        beforeState: diff.before,
        afterState: diff.after,
        metadata: { roleId },
      });
    }
  }

  /**
   * Returns the sorted list of role IDs currently active for a user.
   * Used to diff role-set changes for audit logging (issue #820).
   */
  private async getActiveRoleIds(userId: string): Promise<string[]> {
    const activeAssignments = await this.userRoleRepository.find({
      where: { userId, status: AssignmentStatus.ACTIVE },
    });
    return activeAssignments.map((ur) => ur.roleId).sort();
  }

  async getUserRoles(userId: string): Promise<UserRole[]> {
    return this.userRoleRepository.find({
      where: { userId },
      relations: ['role'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Query the privileged-action audit trail — role changes, permission
   * grants, and workflow approvals/rejections. Backs the
   * `GET /authorization/audit-log` endpoint (see docs/AUDIT_TRAIL.md).
   */
  async queryPermissionAuditLog(query: {
    actorId?: string;
    targetUserId?: string;
    action?: AuditAction;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): ReturnType<PermissionAuditService['query']> {
    return this.permissionAuditService.query(query);
  }

  // Permission Checking
  async checkUserPermissions(
    userId: string,
    permissions: string[],
    context?: IPermissionContext
  ): Promise<boolean> {
    return this.permissionChecker.checkUserHasAnyPermission(userId, permissions, context);
  }

  async checkUserHasAllPermissions(
    userId: string,
    permissions: string[],
    context?: IPermissionContext
  ): Promise<boolean> {
    return this.permissionChecker.checkUserHasAllPermissions(userId, permissions, context);
  }

  async checkPermissions(dto: CheckPermissionDto): Promise<any> {
    return this.permissionChecker.checkPermissions({
      userId: dto.userId,
      permissions: dto.permissions,
      resource: dto.resource,
      context: dto.context,
    });
  }

  // Workflow Management
  async createWorkflow(dto: CreateWorkflowDto, createdBy: string): Promise<ApprovalWorkflow> {
    const workflow = this.workflowRepository.create({
      ...dto,
      createdBy,
    });

    return this.workflowRepository.save(workflow);
  }

  async updateWorkflow(id: string, dto: UpdateWorkflowDto): Promise<ApprovalWorkflow> {
    const workflow = await this.workflowRepository.findOne({ where: { id } });
    if (!workflow) {
      throw new NotFoundException('Workflow not found');
    }

    Object.assign(workflow, dto);
    return this.workflowRepository.save(workflow);
  }

  async getWorkflows(filters?: { teamId?: string; organizationId?: string }): Promise<ApprovalWorkflow[]> {
    const query = this.workflowRepository.createQueryBuilder('workflow');

    if (filters?.teamId) {
      query.andWhere('workflow.teamId = :teamId', { teamId: filters.teamId });
    }

    if (filters?.organizationId) {
      query.andWhere('workflow.organizationId = :organizationId', { organizationId: filters.organizationId });
    }

    return query.getMany();
  }

  // Approval Request Management
  async createAccessRequest(dto: CreateAccessRequestDto, requesterId: string): Promise<ApprovalRequest> {
    const workflow = await this.workflowRepository.findOne({
      where: { id: dto.workflowId },
      relations: ['steps'],
    });

    if (!workflow) {
      throw new NotFoundException('Workflow not found');
    }

    const request = this.requestRepository.create({
      workflowId: dto.workflowId,
      requesterId,
      title: dto.title,
      description: dto.description,
      requestData: dto.requestData,
      teamId: dto.teamId,
      organizationId: dto.organizationId,
      expiresAt: new Date(Date.now() + (workflow.timeoutHours * 60 * 60 * 1000)),
    });

    return this.requestRepository.save(request);
  }

  async createOrGetApprovalRequest(
    userId: string,
    workflowType: WorkflowType,
    requestData: any
  ): Promise<ApprovalRequest> {
    // Find active workflow for this type
    const workflow = await this.workflowRepository.findOne({
      where: {
        type: workflowType,
        status: 'active' as any,
        teamId: requestData.teamId,
        organizationId: requestData.organizationId,
      },
      relations: ['steps'],
    });

    if (!workflow) {
      // No workflow required, create auto-approved request
      const request = this.requestRepository.create({
        workflowId: 'auto',
        requesterId: userId,
        title: requestData.title,
        description: requestData.description,
        requestData: requestData.requestData,
        status: 'approved' as any,
        approvedAt: new Date(),
        approvedBy: userId,
      });

      return this.requestRepository.save(request);
    }

    // Check for existing pending request
    const existingRequest = await this.requestRepository.findOne({
      where: {
        workflowId: workflow.id,
        requesterId: userId,
        status: 'pending' as any,
        requestData: requestData.requestData,
      },
    });

    if (existingRequest) {
      return existingRequest;
    }

    // Create new request
    return this.createAccessRequest({
      workflowId: workflow.id,
      title: requestData.title,
      description: requestData.description,
      requestData: requestData.requestData,
      teamId: requestData.teamId,
      organizationId: requestData.organizationId,
    }, userId);
  }

  async approveRequest(
    requestId: string,
    approverId: string,
    dto: ApproveRequestDto
  ): Promise<ApprovalRequest> {
    const request = await this.requestRepository.findOne({
      where: { id: requestId },
      relations: ['workflow', 'actions'],
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.status !== 'pending') {
      throw new BadRequestException('Request is not pending');
    }

    // Create approval action
    const action = this.actionRepository.create({
      requestId,
      approverId,
      action: 'approved' as any,
      comments: dto.comments,
      metadata: dto.metadata,
    });

    await this.actionRepository.save(action);

    // Update request status if fully approved
    const context = await this.buildEvaluationContext(request);
    const decision = await this.policyEvaluator.evaluateAccessRequest(request, context);

    if (decision.approved) {
      request.status = 'approved' as any;
      request.approvedBy = approverId;
      request.approvedAt = new Date();
    }

    const saved = await this.requestRepository.save(request);

    await this.permissionAuditService.log({
      actorId: approverId,
      targetUserId: request.requesterId,
      action: AuditAction.WORKFLOW_APPROVED,
      resourceName: request.title,
      metadata: {
        requestId,
        workflowId: request.workflowId,
        reason: dto.comments,
        fullyApproved: decision.approved,
      },
    });

    return saved;
  }

  async rejectRequest(
    requestId: string,
    approverId: string,
    dto: RejectRequestDto
  ): Promise<ApprovalRequest> {
    const request = await this.requestRepository.findOne({
      where: { id: requestId },
      relations: ['actions'],
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.status !== 'pending') {
      throw new BadRequestException('Request is not pending');
    }

    // Create rejection action
    const action = this.actionRepository.create({
      requestId,
      approverId,
      action: 'rejected' as any,
      comments: dto.comments,
      metadata: dto.metadata,
    });

    await this.actionRepository.save(action);

    // Update request status
    request.status = 'rejected' as any;
    request.rejectionReason = dto.reason;

    const saved = await this.requestRepository.save(request);

    await this.permissionAuditService.log({
      actorId: approverId,
      targetUserId: request.requesterId,
      action: AuditAction.WORKFLOW_REJECTED,
      resourceName: request.title,
      metadata: {
        requestId,
        workflowId: request.workflowId,
        reason: dto.reason,
        comments: dto.comments,
      },
    });

    return saved;
  }

  async checkRequiresWorkflowApproval(
    userId: string,
    workflowType: WorkflowType,
    context: IPermissionContext
  ): Promise<boolean> {
    const workflow = await this.workflowRepository.findOne({
      where: {
        type: workflowType,
        status: 'active' as any,
        teamId: context.teamId,
        organizationId: context.organizationId,
      },
    });

    return !!workflow;
  }

  private async buildEvaluationContext(request: ApprovalRequest): Promise<any> {
    // Build context for policy evaluation
    return {
      request,
      requester: { id: request.requesterId },
      team: request.teamId ? { id: request.teamId } : undefined,
      organization: request.organizationId ? { id: request.organizationId } : undefined,
    };
  }
}