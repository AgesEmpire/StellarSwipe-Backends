import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Res,
  Header,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
} from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ComplianceExportService } from './compliance-export.service';
import { AuditExportRequestDto } from './dto/export-request.dto';
import { AuditExportResultDto } from './dto/export-result.dto';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { NotFoundException } from '@nestjs/common';

@ApiTags('Compliance Audit Export')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('compliance/audit-exports')
export class ComplianceAuditController {
  constructor(
    private readonly complianceExportService: ComplianceExportService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Export audit logs',
    description:
      'Generates an audit trail export file. Restricted to compliance roles.',
  })
  @ApiOkResponse({
    description: 'Audit export generated',
    type: AuditExportResultDto,
  })
  async export(
    @Req() req: any,
    @Body() dto: AuditExportRequestDto,
  ): Promise<AuditExportResultDto> {
    return this.complianceExportService.export(req.user, dto);
  }

  @Get('download/:fileName')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Download an audit export file' })
  @ApiParam({ name: 'fileName', description: 'Export file name' })
  @Header('Content-Type', 'application/octet-stream')
  async download(
    @Req() req: any,
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ): Promise<void> {
    // Verify compliance role
    this.complianceExportService.assertComplianceRole(req.user);

    const exportDir =
      process.env.EXPORT_DIR || '/tmp/exports';
    const filePath = join(exportDir, fileName);

    if (!existsSync(filePath)) {
      throw new NotFoundException('Export file not found or has expired.');
    }

    const content = await readFile(filePath, 'utf-8');

    // Determine content type based on extension
    const ext = fileName.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      csv: 'text/csv',
      json: 'application/json',
      html: 'text/html',
      pdf: 'application/pdf',
    };

    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    res.send(content);
  }

  @Get('roles')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get allowed compliance roles' })
  getAllowedRoles(): { roles: string[] } {
    return { roles: ['compliance_officer', 'admin', 'auditor'] };
  }
}
