import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AuditExportRequestDto } from './dto/audit-export-request.dto';
import { AuditExportResultDto } from './dto/audit-export-result.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuditExportService {
  constructor(
    @InjectQueue('audit-export') private readonly exportQueue: Queue,
  ) {}

  async requestExport(dto: AuditExportRequestDto): Promise<AuditExportResultDto> {
    const jobId = uuidv4();
    await this.exportQueue.add({
      jobId,
      ...dto,
    }, { priority: 100 }); // NORMAL
    return {
      jobId,
      status: 'PENDING',
      message: 'Export job has been queued.',
    };
  }

  getDownloadLink(jobId: string): string {
    return `/api/v1/audit/export/download/${jobId}`;
  }
}
