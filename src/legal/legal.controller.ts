import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  Request,
} from '@nestjs/common';
import { DocumentManagerService } from './document-manager.service';
import { CreateLegalDocumentDto, UpdateLegalDocumentDto } from './dto/legal-document.dto';
import { CreateDocumentVersionDto } from './dto/document-version.dto';
import { RecordAcceptanceDto } from './dto/acceptance-record.dto';
import { RegionalDocumentQueryDto } from './dto/regional-document.dto';

@Controller('legal')
export class LegalController {
  constructor(private readonly documentManager: DocumentManagerService) {}

  @Post('documents')
  create(@Body() dto: CreateLegalDocumentDto) {
    return this.documentManager.create(dto);
  }

  @Get('documents')
  findAll(@Query() query: RegionalDocumentQueryDto) {
    return this.documentManager.findAll(query);
  }

  @Get('documents/:id')
  findOne(@Param('id') id: string) {
    return this.documentManager.findOne(id);
  }

  @Put('documents/:id')
  update(@Param('id') id: string, @Body() dto: UpdateLegalDocumentDto) {
    return this.documentManager.update(id, dto);
  }

  @Patch('documents/:id/archive')
  archive(@Param('id') id: string) {
    return this.documentManager.archive(id);
  }

  @Post('documents/:id/versions')
  createVersion(@Param('id') id: string, @Body() dto: CreateDocumentVersionDto) {
    return this.documentManager.createVersion(id, dto);
  }

  @Patch('documents/:id/versions/:versionId/publish')
  publishVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Request() req: any,
  ) {
    return this.documentManager.publishVersion(id, versionId, req.user?.id ?? 'system');
  }

  @Get('documents/:id/diff')
  getDiff(
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.documentManager.getVersionDiff(id, from, to);
  }

  @Post('accept')
  recordAcceptance(@Body() dto: RecordAcceptanceDto, @Request() req: any) {
    return this.documentManager.recordAcceptance(req.user?.id, dto, {
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
      region: req.user?.region,
    });
  }

  @Get('pending')
  getPendingDocuments(@Query('region') region: string, @Request() req: any) {
    return this.documentManager.getPendingDocuments(req.user?.id, region);
  }
}
