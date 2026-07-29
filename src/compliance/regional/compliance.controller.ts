import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { RegionalComplianceService } from './regional-compliance.service';
import { RegionConfigDto } from './dto/region-config.dto';
import { ComplianceRegion, ComplianceCheckContext } from './interfaces/compliance-framework.interface';

@Controller('compliance/regional')
export class RegionalComplianceController {
  constructor(private readonly complianceService: RegionalComplianceService) {}

  @Get('frameworks')
  getSupportedRegions() {
    return { regions: Object.values(ComplianceRegion) };
  }

  @Get('frameworks/:region/rules')
  getFrameworkRules(@Param('region') region: ComplianceRegion) {
    return this.complianceService.getFrameworkRules(region);
  }

  @Get('frameworks/:region/documents')
  getRequiredDocuments(@Param('region') region: ComplianceRegion) {
    return { region, documents: this.complianceService.getRequiredDocuments(region) };
  }

  @Get('frameworks/:region/retention')
  getDataRetentionPolicy(@Param('region') region: ComplianceRegion) {
    return this.complianceService.getDataRetentionPolicy(region);
  }

  @Post('check')
  async runComplianceCheck(@Body() context: ComplianceCheckContext) {
    return this.complianceService.runCheck(context);
  }

  @Get('detect')
  detectRegion(@Query('countryCode') countryCode: string) {
    return { region: this.complianceService.detectRegion(countryCode) };
  }

  @Get('history/:userId')
  async getCheckHistory(
    @Param('userId') userId: string,
    @Query('region') region?: ComplianceRegion,
  ) {
    return this.complianceService.getCheckHistory(userId, region);
  }

  @Get('rules/:region')
  async getActiveRules(@Param('region') region: ComplianceRegion) {
    return this.complianceService.getActiveRules(region);
  }
}
