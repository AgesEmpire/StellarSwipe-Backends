import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';

import { SecurityMonitorService } from './monitoring/security-monitor.service';
import { AlertManagerService } from './monitoring/alert-manager.service';
import {
  ResolveAlertDto,
  SecurityAlertQueryDto,
  SecurityDashboardDto,
} from './dto/security-alert.dto';
import { IncidentStatus } from './entities/security-incident.entity';

// Replace with your actual guards
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { RolesGuard } from '../auth/guards/roles.guard';
// import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Security')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/security')
export class SecurityDashboardController {
  constructor(
    private readonly securityMonitor: SecurityMonitorService,
    private readonly alertManager: AlertManagerService,
  ) {}

  // ─── Dashboard ────────────────────────────────────────────────────────────

  @Get('dashboard')
  @ApiOperation({ summary: 'Get security monitoring dashboard (admin)' })
  @ApiResponse({ status: 200, type: SecurityDashboardDto })
  // @Roles('admin')
  async getDashboard() {
    return this.securityMonitor.getDashboard();
  }

  // ─── Alerts ───────────────────────────────────────────────────────────────

  @Get('alerts')
  @ApiOperation({ summary: 'List security alerts with filtering' })
  async getAlerts(@Query() query: SecurityAlertQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.alertManager.getDashboardStats(); // replace with paginated query in production
  }

  @Get('alerts/user/:userId')
  @ApiOperation({ summary: 'Get all alerts for a specific user' })
  async getUserAlerts(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('unresolvedOnly') unresolvedOnly?: boolean,
  ) {
    return this.securityMonitor.getUserAlerts(userId, unresolvedOnly);
  }

  @Patch('alerts/:id/resolve')
  @ApiOperation({ summary: 'Resolve a security alert' })
  async resolveAlert(
    @Param('id', ParseUUIDPipe) alertId: string,
    @Body() dto: ResolveAlertDto,
  ) {
    return this.securityMonitor.resolveAlert(alertId, dto);
  }

  // ─── Incidents ────────────────────────────────────────────────────────────

  @Patch('incidents/:id/status')
  @ApiOperation({ summary: 'Update incident status' })
  async updateIncidentStatus(
    @Param('id', ParseUUIDPipe) incidentId: string,
    @Body() body: { status: IncidentStatus; actorId: string; note?: string },
  ) {
    return this.alertManager.updateIncidentStatus(
      incidentId,
      body.status,
      body.actorId,
      body.note,
    );
  }

  // ─── Account Management ───────────────────────────────────────────────────

  @Post('users/:userId/reset-counters')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Reset security counters for a user (false positive recovery)',
  })
  async resetUserCounters(@Param('userId', ParseUUIDPipe) userId: string) {
    await this.securityMonitor.resetUserSecurityCounters(userId);
  }
}
