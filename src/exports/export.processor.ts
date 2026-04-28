import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BulkExport, ExportFormat, ExportType } from './entities/bulk-export.entity';
import { ExportsService, EXPORT_JOB, EXPORT_QUEUE } from './exports.service';

interface ExportJobData {
  exportId: string;
}

@Processor(EXPORT_QUEUE)
export class ExportProcessor {
  private readonly logger = new Logger(ExportProcessor.name);

  constructor(
    private readonly exportsService: ExportsService,
    @InjectRepository(BulkExport)
    private readonly exportRepo: Repository<BulkExport>,
  ) {}

  @Process(EXPORT_JOB)
  async handleExport(job: Job<ExportJobData>): Promise<void> {
    const { exportId } = job.data;
    this.logger.log(`Processing export ${exportId}`);

    await this.exportsService.markProcessing(exportId);

    try {
      const exportJob = await this.exportRepo.findOne({ where: { id: exportId } });
      if (!exportJob) throw new Error(`Export ${exportId} not found`);

      const rows = await this.generateData(exportJob);
      await this.exportsService.markCompleted(exportId, rows);
    } catch (error) {
      await this.exportsService.markFailed(exportId, (error as Error).message);
      throw error; // Re-throw so Bull can retry
    }
  }

  /**
   * Generates export data based on type and format.
   * Returns the number of rows written.
   *
   * In production this would stream data from the DB and write to S3/GCS.
   * Here we simulate the row count for the queue processing logic.
   */
  private async generateData(exportJob: BulkExport): Promise<number> {
    const { type, format, filters } = exportJob;

    this.logger.log(
      `Generating ${format.toUpperCase()} export for type=${type} filters=${JSON.stringify(filters)}`,
    );

    // Simulate async data generation (DB query + file write)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Return simulated row count per export type
    const rowCounts: Record<ExportType, number> = {
      [ExportType.TRANSACTIONS]: 500,
      [ExportType.CONTEST_RESULTS]: 100,
      [ExportType.SIGNALS]: 250,
      [ExportType.PORTFOLIO]: 50,
    };

    return rowCounts[type] ?? 0;
  }
}
