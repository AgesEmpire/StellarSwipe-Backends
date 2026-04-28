import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as crypto from 'crypto';
import { BulkExport, ExportFormat, ExportStatus, ExportType } from './entities/bulk-export.entity';
import { InitiateExportDto } from './dto/initiate-export.dto';

export const EXPORT_QUEUE = 'bulk-exports';
export const EXPORT_JOB = 'process-export';

/** Temporary download URL TTL: 1 hour */
const URL_TTL_MS = 60 * 60 * 1000;

/** Max concurrent pending/processing exports per user */
const MAX_ACTIVE_EXPORTS = 3;

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    @InjectRepository(BulkExport)
    private readonly exportRepo: Repository<BulkExport>,
    @InjectQueue(EXPORT_QUEUE)
    private readonly exportQueue: Queue,
  ) {}

  async initiate(userId: string, dto: InitiateExportDto): Promise<BulkExport> {
    // Rate-limit: max active exports per user
    const activeCount = await this.exportRepo.count({
      where: [
        { userId, status: ExportStatus.PENDING },
        { userId, status: ExportStatus.PROCESSING },
      ],
    });

    if (activeCount >= MAX_ACTIVE_EXPORTS) {
      throw new HttpException(
        `You already have ${activeCount} active exports. Please wait for them to complete.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const exportJob = this.exportRepo.create({
      userId,
      type: dto.type,
      format: dto.format ?? ExportFormat.CSV,
      status: ExportStatus.PENDING,
      filters: {
        startDate: dto.startDate,
        endDate: dto.endDate,
        ...dto.filters,
      },
    });

    const saved = await this.exportRepo.save(exportJob);

    await this.exportQueue.add(
      EXPORT_JOB,
      { exportId: saved.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 20,
        removeOnFail: 10,
      },
    );

    this.logger.log(`Export ${saved.id} queued for user ${userId}`);
    return saved;
  }

  async findOne(userId: string, exportId: string): Promise<BulkExport> {
    const exportJob = await this.exportRepo.findOne({ where: { id: exportId } });
    if (!exportJob) throw new NotFoundException(`Export ${exportId} not found`);
    if (exportJob.userId !== userId) throw new ForbiddenException();
    return exportJob;
  }

  async listForUser(userId: string): Promise<BulkExport[]> {
    return this.exportRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  /**
   * Called by the queue processor once the file is ready.
   * Generates a signed temporary download URL (token-based).
   */
  async markCompleted(exportId: string, rowCount: number): Promise<void> {
    const token = crypto.randomBytes(32).toString('hex');
    const urlExpiresAt = new Date(Date.now() + URL_TTL_MS);
    const downloadUrl = `/api/v1/exports/${exportId}/download?token=${token}`;

    await this.exportRepo.update(exportId, {
      status: ExportStatus.COMPLETED,
      downloadUrl,
      urlExpiresAt,
      rowCount,
    });

    this.logger.log(`Export ${exportId} completed with ${rowCount} rows`);
  }

  async markFailed(exportId: string, errorMessage: string): Promise<void> {
    await this.exportRepo.update(exportId, {
      status: ExportStatus.FAILED,
      errorMessage,
    });
    this.logger.error(`Export ${exportId} failed: ${errorMessage}`);
  }

  async markProcessing(exportId: string): Promise<void> {
    await this.exportRepo.update(exportId, { status: ExportStatus.PROCESSING });
  }

  /**
   * Validate download token and return export if valid.
   */
  async validateDownload(userId: string, exportId: string, token: string): Promise<BulkExport> {
    const exportJob = await this.findOne(userId, exportId);

    if (exportJob.status !== ExportStatus.COMPLETED) {
      throw new NotFoundException('Export is not ready for download');
    }

    if (!exportJob.urlExpiresAt || exportJob.urlExpiresAt < new Date()) {
      throw new ForbiddenException('Download URL has expired');
    }

    const expectedToken = exportJob.downloadUrl?.split('token=')[1];
    if (!expectedToken || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))) {
      throw new ForbiddenException('Invalid download token');
    }

    return exportJob;
  }
}
