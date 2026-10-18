import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SearchReindexCheckpoint } from '../entities/search-reindex-checkpoint.entity';

/**
 * Durable progress tracking for full search reindex jobs. Backed by the
 * `search_reindex_checkpoints` table so progress survives process restarts
 * and can be queried while a job is running.
 */
@Injectable()
export class SearchReindexCheckpointService {
  private readonly logger = new Logger(SearchReindexCheckpointService.name);

  constructor(
    @InjectRepository(SearchReindexCheckpoint)
    private readonly checkpointRepository: Repository<SearchReindexCheckpoint>,
  ) {}

  async getCheckpoint(jobName: string): Promise<SearchReindexCheckpoint | null> {
    return this.checkpointRepository.findOne({ where: { jobName } });
  }

  /**
   * Resolve the offset a job named `jobName` should resume from, given the
   * current total record count. A checkpoint only resumes the job when:
   *  - it exists and was not already marked complete, and
   *  - its recorded total matches the current total (otherwise the
   *    underlying data set changed shape since the last run and resuming
   *    from a stale offset could skip or duplicate records).
   */
  async resolveResumeOffset(jobName: string, total: number): Promise<number> {
    const checkpoint = await this.getCheckpoint(jobName);
    if (!checkpoint || checkpoint.completedAt) {
      return 0;
    }
    if (checkpoint.total !== total) {
      this.logger.warn(
        `Checkpoint for "${jobName}" was recorded against ${checkpoint.total} records but ${total} are present now; restarting from zero`,
      );
      return 0;
    }
    return Math.min(checkpoint.processed, total);
  }

  async saveProgress(jobName: string, processed: number, total: number): Promise<void> {
    await this.checkpointRepository.upsert(
      { jobName, processed, total, completedAt: null },
      ['jobName'],
    );
  }

  async markCompleted(jobName: string, total: number): Promise<void> {
    await this.checkpointRepository.upsert(
      { jobName, processed: total, total, completedAt: new Date() },
      ['jobName'],
    );
  }

  async reset(jobName: string): Promise<void> {
    await this.checkpointRepository.delete({ jobName });
  }

  async listAll(): Promise<SearchReindexCheckpoint[]> {
    return this.checkpointRepository.find();
  }
}
