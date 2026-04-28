import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  NotFoundException,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../admin/guards/admin-role.guard';
import { AuditService, AuditLogPage } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import { AuditLog } from './entities/audit-log.entity';

/**
 * Audit Controller — read-only query surface for audit logs.
 * Mutating operations (create / update / delete) are intentionally absent.
 * All endpoints require admin authentication (issue #481).
 */
@ApiTags('Audit Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminRoleGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Query audit logs with filtering and pagination (admin only)' })
  @ApiOkResponse({ description: 'Paginated audit log results' })
  async query(@Query() dto: AuditQueryDto): Promise<AuditLogPage> {
    return this.auditService.query(dto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single audit log entry by ID' })
  @ApiParam({ name: 'id', description: 'Audit log UUID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AuditLog> {
    const log = await this.auditService.findById(id);
    if (!log) throw new NotFoundException(`Audit log ${id} not found`);
    return log;
  }

  @Get('users/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get audit trail for a specific user' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  async getUserTrail(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('limit') limit = 100,
  ): Promise<AuditLog[]> {
    return this.auditService.getUserAuditTrail(userId, Number(limit));
  }

  @Get('resources/:resource/:resourceId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get audit trail for a specific resource' })
  async getResourceTrail(
    @Param('resource') resource: string,
    @Param('resourceId') resourceId: string,
    @Query('limit') limit = 100,
  ): Promise<AuditLog[]> {
    return this.auditService.getResourceAuditTrail(resource, resourceId, Number(limit));
  }

  @Get('compliance/export/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export audit logs for compliance reporting' })
  async complianceExport(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ): Promise<AuditLog[]> {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    return this.auditService.exportForCompliance(userId, start, end);
  }
}
