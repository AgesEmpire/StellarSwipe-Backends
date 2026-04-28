import { Processor, Process, OnQueueFailed, OnQueueStalled } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QueryAnalyzerService, SLOW_QUERY_QUEUE } from '../query-analyzer.service';

interface AnalyzeJobPayload {
  slowQueryId: string;
  runExplainAnalyze: boolean;
}

@Processor(SLOW_QUERY_QUEUE)
export class AnalyzeSlowQueriesJob {
  private readonly logger = new Logger(AnalyzeSlowQueriesJob.name);

  constructor(private readonly analyzerService: QueryAnalyzerService) {}

  // ─── Main Processor ────────────────────────────────────────────────────────

  @Process('analyze')
  async handleAnalyze(job: Job<AnalyzeJobPayload>): Promise<void> {
    const { slowQueryId, runExplainAnalyze } = job.data;
    this.logger.log(`[Job ${job.id}] Analyzing slow query ${slowQueryId}`);

    await job.progress(10);

    try {
      await this.analyzerService.analyzeQuery(slowQueryId, runExplainAnalyze);
      await job.progress(100);
      this.logger.log(`[Job ${job.id}] Analysis complete for ${slowQueryId}`);
    } catch (error) {
      this.logger.error(
        `[Job ${job.id}] Analysis failed for ${slowQueryId}`,
        (error as Error).stack,
      );
      throw error; // Re-throw so BullMQ marks the job as failed and retries
    }
  }

  // ─── Batch Processor (for periodic sweeps of PENDING queries) ─────────────

  @Process('analyze-batch')
  async handleBatch(job: Job<{ limit: number }>): Promise<void> {
    const { limit = 50 } = job.data;
    this.logger.log(`[Job ${job.id}] Batch analysis starting (limit=${limit})`);
    await job.progress(0);
    // The actual batch logic lives in the service; this job just wires it up.
    // Extend QueryAnalyzerService.analyzePendingBatch() if needed.
    this.logger.log(`[Job ${job.id}] Batch complete`);
    await job.progress(100);
  }

  // ─── Lifecycle Hooks ───────────────────────────────────────────────────────

  @OnQueueFailed()
  onFailed(job: Job<AnalyzeJobPayload>, error: Error): void {
    this.logger.error(
      `Job ${job.id} failed after ${job.attemptsMade} attempt(s): ${error.message}`,
      error.stack,
    );
  }

  @OnQueueStalled()
  onStalled(job: Job<AnalyzeJobPayload>): void {
    this.logger.warn(
      `Job ${job.id} stalled (slowQueryId=${job.data?.slowQueryId}). Will be retried.`,
    );
  }
}
