import { Controller, Post, Body, UseGuards, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuditExportService } from './audit-export.service';
import { AuditExportRequestDto } from './dto/audit-export-request.dto';
import { AdminRoleGuard } from '../../admin/guards/admin-role.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import * as path from 'path';

@Controller('audit/export')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class AuditExportController {
  constructor(private readonly exportService: AuditExportService) {}

  @Post()
  async requestExport(@Body() dto: AuditExportRequestDto) {
    return this.exportService.requestExport(dto);
  }

  @Get('download/:jobId')
  async downloadExport(@Param('jobId') jobId: string, @Res() res: Response) {
    const filePath = path.join(process.cwd(), 'exports', `${jobId}.csv`);
    res.download(filePath);
  }
}
