import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrphanedTrustlineScanJob } from './orphaned-trustline-scan.job';

@Controller('admin/trustlines/orphaned')
@UseGuards(JwtAuthGuard)
export class OrphanedTrustlineReportController {
  constructor(private readonly scanJob: OrphanedTrustlineScanJob) {}

  /**
   * GET /admin/trustlines/orphaned
   * Returns all trustlines flagged as orphaned (asset no longer active).
   * Admin-only — callers without admin privileges should be denied at the
   * guard layer (role guard to be wired by the consuming module).
   */
  @Get()
  async listOrphaned() {
    const trustlines = await this.scanJob.getOrphanedTrustlines();
    return { count: trustlines.length, trustlines };
  }

  /**
   * POST /admin/trustlines/orphaned/scan
   * Triggers an immediate orphaned-trustline scan outside the cron schedule.
   * Useful for admin-initiated ad-hoc audits.
   */
  @Post('scan')
  @HttpCode(HttpStatus.OK)
  async triggerScan() {
    const result = await this.scanJob.scan();
    return result;
  }
}
