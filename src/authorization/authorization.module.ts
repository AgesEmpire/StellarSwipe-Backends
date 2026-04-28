import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacService } from './rbac.service';
import { RbacController } from './rbac.controller';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { UserRole } from './entities/user-role.entity';
import { ApprovalWorkflow } from './entities/approval-workflow.entity';
import { ApprovalRequest } from './entities/approval-workflow.entity';
import { ApprovalAction } from './entities/approval-workflow.entity';
import { PermissionChecker } from './utils/permission-checker';
import { PolicyEvaluator } from './utils/policy-evaluator';
import { PermissionsGuard } from './guards/permissions.guard';
import { WorkflowApprovalGuard } from './guards/workflow-approval.guard';
import { PermissionAuditService, PermissionAuditLog } from '../auth/permission-audit.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Role,
      Permission,
      UserRole,
      ApprovalWorkflow,
      ApprovalRequest,
      ApprovalAction,
      PermissionAuditLog,
    ]),
  ],
  controllers: [RbacController],
  providers: [
    RbacService,
    PermissionChecker,
    PolicyEvaluator,
    PermissionsGuard,
    WorkflowApprovalGuard,
    PermissionAuditService,
  ],
  exports: [
    RbacService,
    PermissionChecker,
    PolicyEvaluator,
    PermissionsGuard,
    WorkflowApprovalGuard,
    PermissionAuditService,
    TypeOrmModule,
  ],
})
export class AuthorizationModule {}