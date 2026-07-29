import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ExportsService } from './exports.service';
import { InitiateExportDto } from './dto/initiate-export.dto';
import { TaxReportDto } from './dto/tax-report.dto';
import { Audit } from '../audit-log/interceptors/audit-logging.interceptor';
import { AuditAction } from '../audit-log/entities/audit-log.entity';
import { ExportType } from './entities/bulk-export.entity';
import { RateLimit, RateLimitTier } from '../common/decorators/rate-limit.decorator';

@UseGuards(JwtAuthGuard)
@Controller('exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  /**
   * POST /exports
   * Initiate an async bulk export. Returns immediately with the export job.
   * Poll GET /exports/:id for status.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit({ action: AuditAction.BULK_EXPORT_INITIATED, resource: 'export' })
  @RateLimit({ tier: RateLimitTier.AUTHENTICATED, limit: 10, window: 3600 })
  initiate(
    @Request() req: { user: { id: string } },
    @Body() dto: InitiateExportDto,
  ) {
    return this.exportsService.initiate(req.user.id, dto);
  }

  /**
   * POST /exports/tax-report
   * Request a tax report export for the authenticated user.
   * Supports date range filtering and CSV/JSON formats.
   * Processing is asynchronous — poll GET /exports/:id for status.
   */
  @Post('tax-report')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit({ action: AuditAction.BULK_EXPORT_INITIATED, resource: 'tax-report' })
  @RateLimit({ tier: RateLimitTier.AUTHENTICATED, limit: 5, window: 3600 })
  initiateTaxReport(
    @Request() req: { user: { id: string } },
    @Body() dto: TaxReportDto,
  ) {
    return this.exportsService.initiate(req.user.id, {
      type: ExportType.TAX_REPORT,
      format: dto.format,
      startDate: dto.startDate,
      endDate: dto.endDate,
    });
  }

  /**
   * GET /exports
   * List all exports for the authenticated user.
   */
  @Get()
  list(@Request() req: { user: { id: string } }) {
    return this.exportsService.listForUser(req.user.id);
  }

  /**
   * GET /exports/:id
   * Get status of a specific export job.
   */
  @Get(':id')
  findOne(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.exportsService.findOne(req.user.id, id);
  }

  /**
   * GET /exports/:id/download?token=...
   * Download the completed export file via temporary signed URL.
   */
  @Get(':id/download')
  @Audit({ action: AuditAction.BULK_EXPORT_DOWNLOADED, resource: 'export', getResourceId: (req) => req.params.id })
  async download(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Query('token') token: string,
  ) {
    const exportJob = await this.exportsService.validateDownload(req.user.id, id, token);
    // In production: redirect to S3 pre-signed URL or stream file
    return {
      exportId: exportJob.id,
      type: exportJob.type,
      format: exportJob.format,
      rowCount: exportJob.rowCount,
      downloadUrl: exportJob.downloadUrl,
      expiresAt: exportJob.urlExpiresAt,
    };
  }
}
