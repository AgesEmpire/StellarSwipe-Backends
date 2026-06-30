import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PermissionAuditService, AuditAction } from '../auth/permission-audit.service';
import { AdminRoleGuard } from './guards/admin-role.guard';

@ApiTags('Admin Audit')
@ApiBearerAuth()
@UseGuards(AdminRoleGuard)
@Controller('admin/audit/permissions')
export class AdminAuditController {
  constructor(private readonly permissionAuditService: PermissionAuditService) {}

  @Get()
  @ApiOperation({ summary: 'Query permission/role change audit history' })
  @ApiQuery({ name: 'actorId', required: false })
  @ApiQuery({ name: 'targetUserId', required: false })
  @ApiQuery({ name: 'action', required: false, enum: AuditAction })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async queryAuditLog(
    @Query('actorId') actorId?: string,
    @Query('targetUserId') targetUserId?: string,
    @Query('action') action?: AuditAction,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.permissionAuditService.query({
      actorId,
      targetUserId,
      action,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Get('users/:userId')
  @ApiOperation({ summary: 'Get full permission audit trail for a specific user' })
  async getUserAuditTrail(@Param('userId') userId: string) {
    return this.permissionAuditService.getTrailForUser(userId);
  }

  @Get('actors/:actorId')
  @ApiOperation({ summary: 'Get all permission changes made by a specific admin' })
  async getActorAuditTrail(@Param('actorId') actorId: string) {
    return this.permissionAuditService.query({ actorId });
  }
}
