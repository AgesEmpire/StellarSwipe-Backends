import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminRoleGuard } from '../admin/guards/admin-role.guard';
import { PnlSnapshotService } from './services/pnl-snapshot.service';
import { PnlSnapshotStatusDto } from './dto/pnl-snapshot-status.dto';

@ApiTags('admin/portfolio')
@ApiBearerAuth()
@UseGuards(AdminRoleGuard)
@Controller('admin/portfolio')
export class PnlSnapshotAdminController {
  constructor(private readonly pnlSnapshotService: PnlSnapshotService) {}

  @Get('snapshot-status')
  @ApiOperation({ summary: 'Get hourly portfolio P&L snapshot status' })
  @ApiResponse({ status: 200, type: PnlSnapshotStatusDto })
  getSnapshotStatus(): PnlSnapshotStatusDto {
    return this.pnlSnapshotService.getStatus();
  }
}
