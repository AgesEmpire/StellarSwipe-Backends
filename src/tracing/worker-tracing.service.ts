import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Job } from 'bull';
import { TracingService, TRACE_ID_HEADER } from './tracing.service';

export const WORKER_TRACE_ID_KEY = 'traceId';

/**
 * WorkerTracingService — tracing support for asynchronous worker/job execution.
 *
 * Bridges the gap between HTTP-layer tracing (TracingMiddleware) and Bull
 * worker processors.  A trace ID is:
 *   - Propagated from the job's data payload when the enqueuing caller
 *     embedded one (end-to-end correlation).
 *   - Generated fresh (UUID v4) when no trace ID is present, so every job
 *     execution is always identifiable in logs.
 *
 * Usage in a Bull @Processor:
 *
 *   @Process('my-job')
 *   async handle(job: Job): Promise<void> {
 *     const traceId = this.workerTracing.start(job);
 *     try {
 *       // ... do work ...
 *       this.workerTracing.finish(traceId, job);
 *     } catch (err) {
 *       this.workerTracing.error(traceId, job, err as Error);
 *       throw err;
 *     }
 *   }
 *
 * Security: no authentication tokens or secrets are logged.  The service
 * only reads/writes the traceId field and delegates all structured logging
 * to TracingService, preserving existing access-control semantics.
 */
@Injectable()
export class WorkerTracingService {
  private readonly logger = new Logger(WorkerTracingService.name);

  constructor(private readonly tracingService: TracingService) {}

  /**
   * Begin tracing a worker job.
   *
   * Extracts an existing trace ID from `job.data[WORKER_TRACE_ID_KEY]` or
   * from the legacy HTTP header key stored in job data, falling back to a
   * freshly generated UUID.
   *
   * @returns The trace ID that should be threaded through the job execution.
   */
  start(job: Job): string {
    if (!this.tracingService.isEnabled) {
      return '';
    }

    const traceId =
      (job.data as Record<string, unknown>)?.[WORKER_TRACE_ID_KEY] as string |
      undefined ??
      (job.data as Record<string, unknown>)?.[TRACE_ID_HEADER] as string |
      undefined ??
      randomUUID();

    this.tracingService.log(
      traceId,
      `worker:start queue="${job.queue.name}" job=${job.id} name="${job.name}"`,
    );

    return traceId;
  }

  /**
   * Record successful completion of a worker job.
   */
  finish(traceId: string, job: Job): void {
    if (!this.tracingService.isEnabled || !traceId) return;

    this.tracingService.log(
      traceId,
      `worker:finish queue="${job.queue.name}" job=${job.id} name="${job.name}"`,
    );
  }

  /**
   * Record a worker job failure.
   */
  error(traceId: string, job: Job, err: Error): void {
    if (!this.tracingService.isEnabled || !traceId) return;

    this.logger.error(
      `[trace:${traceId}] worker:error queue="${job.queue.name}" job=${job.id} name="${job.name}": ${err.message}`,
    );
  }

  /**
   * Build job data that carries the current trace ID forward so downstream
   * workers can continue the same trace.
   *
   * @param payload   The original job payload.
   * @param traceId   The trace ID to embed (e.g. from an HTTP request).
   */
  injectTraceId(
    payload: Record<string, unknown>,
    traceId: string,
  ): Record<string, unknown> {
    return { ...payload, [WORKER_TRACE_ID_KEY]: traceId };
  }
}
