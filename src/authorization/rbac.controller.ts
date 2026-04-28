import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { RbacService } from './rbac.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/create-role.dto';
import { AssignPermissionDto, CheckPermissionDto } from './dto/assign-permission.dto';
import { CreateWorkflowDto, UpdateWorkflowDto } from './dto/workflow-config.dto';
import {
  CreateAccessRequestDto,
  UpdateAccessRequestDto,
  ApproveRequestDto,
  RejectRequestDto,
  AccessRequestQueryDto,
} from './dto/access-request.dto';
import { RequirePermissions, RequireWorkflowApproval } from './decorators/require-permissions.decorator';
import { PermissionsGuard } from './guards/permissions.guard';
import { WorkflowApprovalGuard } from './guards/workflow-approval.guard';

@Controller('authorization')
@UseGuards(PermissionsGuard)
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  // Role Management Endpoints
  @Post('roles')
  @RequirePermissions('roles:create')
  async createRole(@Body() dto: CreateRoleDto, @Request() req: any) {
    return this.rbacService.createRole(dto, req.user.id);
  }

  @Put('roles/:id')
  @RequirePermissions('roles:update')
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto, @Request() req: any) {
    return this.rbacService.updateRole(id, dto, req.user?.id);
  }

  @Delete('roles/:id')
  @RequirePermissions('roles:delete')
  async deleteRole(@Param('id') id: string) {
    await this.rbacService.deleteRole(id);
    return { message: 'Role deleted successfully' };
  }

  @Get('roles/:id')
  @RequirePermissions('roles:read')
  async getRole(@Param('id') id: string) {
    return this.rbacService.getRole(id);
  }

  @Get('roles')
  @RequirePermissions('roles:read')
  async getRoles(
    @Query('teamId') teamId?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.rbacService.getRoles({ teamId, organizationId });
  }

  // Permission Management Endpoints
  @Post('permissions/assign')
  @RequirePermissions('permissions:assign')
  async assignPermissionsToRole(@Body() dto: AssignPermissionDto, @Request() req: any) {
    return this.rbacService.assignPermissionsToRole(dto, req.user?.id);
  }

  @Get('permissions')
  @RequirePermissions('permissions:read')
  async getPermissions() {
    return this.rbacService.getPermissions();
  }

  // User Role Assignment Endpoints
  @Post('users/:userId/roles/:roleId')
  @RequirePermissions('user-roles:assign')
  @RequireWorkflowApproval('role_assignment', 'user-roles', 'assign')
  async assignRoleToUser(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @Body() body: { teamId?: string; organizationId?: string; expiresAt?: Date },
    @Request() req: any,
  ) {
    return this.rbacService.assignRoleToUser(userId, roleId, req.user.id, body);
  }

  @Delete('users/:userId/roles/:roleId')
  @RequirePermissions('user-roles:revoke')
  async revokeRoleFromUser(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @Request() req: any,
  ) {
    await this.rbacService.revokeRoleFromUser(userId, roleId, req.user?.id);
    return { message: 'Role revoked successfully' };
  }

  @Get('users/:userId/roles')
  @RequirePermissions('user-roles:read')
  async getUserRoles(@Param('userId') userId: string) {
    return this.rbacService.getUserRoles(userId);
  }

  // Permission Checking Endpoints
  @Post('permissions/check')
  @RequirePermissions('permissions:check')
  async checkPermissions(@Body() dto: CheckPermissionDto) {
    return this.rbacService.checkPermissions(dto);
  }

  @Get('permissions/check/:userId')
  @RequirePermissions('permissions:check')
  async checkUserPermissions(
    @Param('userId') userId: string,
    @Query('permissions') permissions: string,
    @Query('resource') resource?: string,
  ) {
    if (!permissions) {
      throw new BadRequestException('Permissions query parameter is required');
    }

    const permissionArray = permissions.split(',');
    const hasPermission = await this.rbacService.checkUserPermissions(userId, permissionArray, {
      resource,
    });

    return { hasPermission, userId, permissions: permissionArray, resource };
  }

  // Workflow Management Endpoints
  @Post('workflows')
  @RequirePermissions('workflows:create')
  async createWorkflow(@Body() dto: CreateWorkflowDto, @Request() req: any) {
    return this.rbacService.createWorkflow(dto, req.user.id);
  }

  @Put('workflows/:id')
  @RequirePermissions('workflows:update')
  async updateWorkflow(@Param('id') id: string, @Body() dto: UpdateWorkflowDto) {
    return this.rbacService.updateWorkflow(id, dto);
  }

  @Get('workflows')
  @RequirePermissions('workflows:read')
  async getWorkflows(
    @Query('teamId') teamId?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.rbacService.getWorkflows({ teamId, organizationId });
  }

  // Approval Request Endpoints
  @Post('requests')
  @RequirePermissions('requests:create')
  async createAccessRequest(@Body() dto: CreateAccessRequestDto, @Request() req: any) {
    return this.rbacService.createAccessRequest(dto, req.user.id);
  }

  @Put('requests/:id')
  @RequirePermissions('requests:update')
  async updateAccessRequest(@Param('id') id: string, @Body() dto: UpdateAccessRequestDto) {
    // Implementation would update the request
    return { message: 'Request updated', id };
  }

  @Post('requests/:id/approve')
  @RequirePermissions('requests:approve')
  async approveRequest(
    @Param('id') id: string,
    @Body() dto: ApproveRequestDto,
    @Request() req: any,
  ) {
    return this.rbacService.approveRequest(id, req.user.id, dto);
  }

  @Post('requests/:id/reject')
  @RequirePermissions('requests:reject')
  async rejectRequest(
    @Param('id') id: string,
    @Body() dto: RejectRequestDto,
    @Request() req: any,
  ) {
    return this.rbacService.rejectRequest(id, req.user.id, dto);
  }

  @Get('requests')
  @RequirePermissions('requests:read')
  async getAccessRequests(@Query() query: AccessRequestQueryDto) {
    // Implementation would return filtered requests
    return { message: 'Requests retrieved', query };
  }

  @Get('requests/:id')
  @RequirePermissions('requests:read')
  async getAccessRequest(@Param('id') id: string) {
    // Implementation would return specific request
    return { message: 'Request retrieved', id };
  }

  // Health Check Endpoint
  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'RBAC Service',
    };
  }
}