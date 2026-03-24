import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { SlaManagerService } from './sla-manager.service';
import { SlaConfigDto } from './dto/sla-config.dto';
import { SlaReportQueryDto } from './dto/sla-report.dto';
import { SlaTierName } from './interfaces/sla-tier.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('enterprise/sla')
@UseGuards(JwtAuthGuard)
export class SlaController {
  constructor(private readonly slaManager: SlaManagerService) {}

  @Post('agreements')
  create(@Body() dto: SlaConfigDto) {
    return this.slaManager.createAgreement(dto);
  }

  @Get('agreements')
  list(@Query('tier') tier?: SlaTierName) {
    return this.slaManager.listAgreements(tier);
  }

  @Get('agreements/:id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.slaManager.getAgreement(id);
  }

  @Patch('agreements/:id/terminate')
  terminate(@Param('id', ParseUUIDPipe) id: string) {
    return this.slaManager.terminateAgreement(id);
  }

  @Get('agreements/:id/report')
  async getReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SlaReportQueryDto,
  ) {
    const end = query.startDate ? new Date(query.startDate) : new Date();
    const start = query.startDate
      ? new Date(query.startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return this.slaManager.generateReport(id, start, end);
  }

  @Get('agreements/:id/violations')
  getViolations(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('since') since?: string,
  ) {
    return this.slaManager.getViolations(id, since ? new Date(since) : undefined);
  }

  @Patch('violations/:id/resolve')
  resolveViolation(@Param('id', ParseUUIDPipe) id: string) {
    return this.slaManager.resolveViolation(id);
  }

  @Post('agreements/:id/check')
  checkViolations(@Param('id', ParseUUIDPipe) id: string) {
    return this.slaManager.checkAndRecordViolations(id);
  }
}
