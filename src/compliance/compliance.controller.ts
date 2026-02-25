import { Controller, Get, Post, Query, UseGuards, Req, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { GeoBlockService } from './geo-blocking/geo-block.service';
import { SanctionsScreeningService } from './geo-blocking/sanctions-screening.service';
import { ComplianceReportingService } from './compliance-reporting.service';
import { ComplianceService } from './compliance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ExportRequestDto } from './dto/export-request.dto';
import { ComplianceReportDto } from './dto/compliance-report.dto';

@Controller('compliance')
@UseGuards(JwtAuthGuard)
export class ComplianceController {
  constructor(
    private geoBlockService: GeoBlockService,
    private sanctionsService: SanctionsScreeningService,
    private reportingService: ComplianceReportingService,
    private complianceService: ComplianceService,
  ) {}

  @Post('export/user-data')
  @HttpCode(HttpStatus.ACCEPTED)
  async exportUserData(@Req() req: any, @Body() dto: ExportRequestDto) {
    const userId = req.user.id;
    const filePath = await this.complianceService.exportUserData(userId, dto.format);

    return {
      message: 'Export initiated successfully',
      format: dto.format,
      expiresIn: '7 days',
      downloadUrl: `/compliance/download/${filePath.split('/').pop()}`,
    };
  }

  @Post('reports/generate')
  async generateReport(@Body() dto: ComplianceReportDto) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    const report = await this.complianceService.generateComplianceReport(dto.type, startDate, endDate);

    return {
      reportType: dto.type,
      period: { startDate: dto.startDate, endDate: dto.endDate },
      data: report,
      generatedAt: new Date().toISOString(),
    };
  }

  @Get('blocked-countries')
  getBlockedCountries(): { countries: string[] } {
    return {
      countries: this.geoBlockService.getBlockedCountries(),
    };
  }

  @Get('check-ip')
  async checkIP(@Query('ip') ip: string) {
    const location = await this.geoBlockService.getGeoLocation(ip);
    const isBlocked = this.geoBlockService.isBlocked(location.countryCode);

    return {
      ...location,
      isBlocked,
    };
  }

  @Post('screen-wallet')
  async screenWallet(@Body('address') address: string) {
    return this.sanctionsService.screenWalletAddress(address);
  }

  @Post('screen-user')
  async screenUser(@Body() data: { walletAddress?: string; email?: string; name?: string }) {
    return this.sanctionsService.screenUser(data);
  }

  @Get('stats')
  getComplianceStats() {
    return {
      blockedCountries: this.geoBlockService.getBlockedCountries().length,
      blockedWallets: this.sanctionsService.getBlockedWalletsCount(),
      blockedEmails: this.sanctionsService.getBlockedEmailsCount(),
    };
  }

  @Get('report')
  async getComplianceReport(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    return this.reportingService.generateReport(start, end);
  }

  @Get('recent-blocks')
  async getRecentBlocks(@Query('limit') limit?: number) {
    return this.reportingService.getRecentBlocks(limit ? parseInt(limit as any) : 100);
  }

  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      geoBlocking: 'active',
      sanctionsScreening: 'active',
      dataExport: 'active',
      timestamp: new Date().toISOString(),
    };
  }
}
