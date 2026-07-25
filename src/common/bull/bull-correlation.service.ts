import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { CorrelationIdStore } from '../correlation/correlation-id.store';

/**
 * Helper service for propagating request correlation IDs into BullMQ job payloads.
 *
 * When a job is enqueued from an HTTP request handler, this service captures
 * the current request's correlation ID and adds it to the job payload. This
 * allows end-to-end tracing from the originating HTTP request through background
 * job processing.
 *
 * For jobs enqueued outside an HTTP context (e.g., cron triggers, manual operations),
 * a new correlation ID is generated to maintain traceability.
 *
 * Usage:
 * ```
 * // In your job service:
 * const jobPayload = {
 *   entityId: 'abc-123',
 *   data: {...},
 *   correlationId: this.bullCorrelation.captureCorrelationId(),
 * };
 * await this.queue.add('job-name', jobPayload, options);
 * ```
 *
 * Then in your job processor:
 * ```
 * @Process(JOB_NAME)
 * async handleJob(job: Job<JobPayload>) {
 *   const { correlationId } = job.data;
 *   this.logger.log(`Processing job`, { correlationId });
 * }
 * ```
 */
@Injectable()
export class BullCorrelationService {
  private readonly logger = new Logger(BullCorrelationService.name);

  constructor(private readonly correlationIdStore: CorrelationIdStore) {}

  /**
   * Capture the current request's correlation ID for a job.
   *
   * If called within an HTTP request context, returns the request's correlation ID.
   * If called outside an HTTP context (e.g., cron job, background task), generates
   * a new correlation ID.
   *
   * @returns correlation ID (either from request or newly generated)
   */
  captureCorrelationId(): string {
    const existing = this.correlationIdStore.getCorrelationId();

    if (existing) {
      return existing;
    }

    // Generate new correlation ID for jobs outside HTTP context
    const newId = uuidv4();
    this.logger.debug(`Generated new correlation ID for out-of-request job: ${newId}`);
    return newId;
  }

  /**
   * Get the correlation ID from job data, with fallback to generate if missing.
   *
   * Safe to call even if job.data doesn't have correlationId field.
   *
   * @param jobData - the job's data payload
   * @returns correlation ID
   */
  getJobCorrelationId(jobData: Record<string, unknown>): string {
    if (jobData?.correlationId && typeof jobData.correlationId === 'string') {
      return jobData.correlationId;
    }

    // Fallback: generate new ID if not present
    const newId = uuidv4();
    this.logger.warn(`Job missing correlationId field, generated fallback: ${newId}`);
    return newId;
  }
}
