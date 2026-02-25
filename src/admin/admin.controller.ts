import { Controller, Get, Put, Delete, Param, Query, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { AdminManagementService } from './admin.service';
import { UserManagementQueryDto, SuspendUserDto } from './dto/user-management.dto';
import { SignalModerationQueryDto, RemoveSignalDto } from './dto/signal-moderation.dto';
import { AdminAnalyticsService } from './analytics/admin-analytics.service';
import { AnalyticsQueryDto } from './analytics/dto/analytics-query.dto';

// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { RolesGuard } from '../common/guards/roles.guard';
// import { Roles } from '../common/decorators/roles.decorator';
// import { UserRole } from '../users/enums/user-role.enum';
// Using placeholders for auth guards based on usual NestJS conventions mapped in the project
import { AdminRoleGuard } from './guards/admin-role.guard';

@ApiTags('Admin Management')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard, AdminRoleGuard)
@Controller('admin')
export class AdminController {
    constructor(
        private readonly adminService: AdminManagementService,
        private readonly analyticsService: AdminAnalyticsService,
    ) { }

    // --- USER MANAGEMENT ---

    @Get('users')
    @ApiOperation({ summary: 'List users with filters' })
    async getUsers(@Query() query: UserManagementQueryDto) {
        return this.adminService.getUsers(query);
    }

    @Get('users/:id')
    @ApiOperation({ summary: 'View user details' })
    @ApiParam({ name: 'id', description: 'User ID' })
    async getUserDetails(@Param('id') id: string) {
        return this.adminService.getUserById(id);
    }

    @Put('users/:id/suspend')
    @ApiOperation({ summary: 'Suspend a user account' })
    @ApiParam({ name: 'id', description: 'User ID' })
    async suspendUser(
        @Request() req: any,
        @Param('id') id: string,
        @Body() dto: SuspendUserDto
    ) {
        // In real app, `adminId` comes from `req.user.id` when JwtAuthGuard is active
        const adminId = req.user?.id || 'system-admin-id';
        return this.adminService.suspendUser(adminId, id, dto);
    }

    @Put('users/:id/unsuspend')
    @ApiOperation({ summary: 'Unsuspend a user account' })
    @ApiParam({ name: 'id', description: 'User ID' })
    async unsuspendUser(
        @Request() req: any,
        @Param('id') id: string
    ) {
        const adminId = req.user?.id || 'system-admin-id';
        return this.adminService.unsuspendUser(adminId, id);
    }

    // --- SIGNAL MODERATION ---

    @Get('signals/flagged')
    @ApiOperation({ summary: 'Get flagged or reported signals' })
    async getFlaggedSignals(@Query() query: SignalModerationQueryDto) {
        return this.adminService.getFlaggedSignals(query);
    }

    @Delete('signals/:id')
    @ApiOperation({ summary: 'Remove a malicious or inappropriate signal' })
    @ApiParam({ name: 'id', description: 'Signal ID' })
    async removeSignal(
        @Request() req: any,
        @Param('id') id: string,
        @Body() dto: RemoveSignalDto
    ) {
        const adminId = req.user?.id || 'system-admin-id';
        return this.adminService.removeSignal(adminId, id, dto);
    }

    // --- ANALYTICS DASHBOARD (Delegated to Analytics Module) ---

    @Get('analytics')
    @ApiOperation({ summary: 'Get platform analytics overview' })
    async getAnalyticsDashboard(@Query() query: AnalyticsQueryDto) {
        return this.analyticsService.getOverview(query);
    }
}
