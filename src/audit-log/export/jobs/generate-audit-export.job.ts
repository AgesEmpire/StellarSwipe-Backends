import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { AuditService } from '../../audit.service';
import { formatAuditLogCsv } from '../utils/export-formatters';
import * as fs from 'fs/promises';
import * as path from 'path';
import { writeExportAtomically } from '../../../common/utils/atomic-export.util';

@Processor('audit-export')
export class GenerateAuditExportJob {
  private readonly logger = new Logger(GenerateAuditExportJob.name);

  constructor(private readonly auditService: AuditService) {}

  @Process()
  async handleExport(job: Job) {
    const { startDate, endDate, eventType, jobId, userId } = job.data;
    this.logger.log(`Generating audit export for job ${jobId}`);
    
    const logs = await this.auditService.exportForCompliance(userId || 'system', new Date(startDate), new Date(endDate));
    const csvData = formatAuditLogCsv(logs);
    
    const exportDir = path.join(process.cwd(), 'exports');
    const filePath = await writeExportAtomically(exportDir, `${jobId}.csv`, csvData);
    
    this.logger.log(`Export ${jobId} completed and atomically published to ${filePath}`);
    return { filePath };
  }
}
