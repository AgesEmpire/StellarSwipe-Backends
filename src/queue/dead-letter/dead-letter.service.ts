import { Injectable, Logger } from '@nestjs/common';

/**
 * Safe, serializable error context stored alongside a dead-lettered message.
 * Must never contain secrets or PII.
 */
export interface DeadLetterErrorContext {
  name: string;
  message: string;
  stack?: string;
}

/**
 * A durable record of a queue message that exhausted its retry budget.
 */
export interface DeadLetterRecord<T = unknown> {
  id: string;
  queue: string;
  jobName: string;
  payload: T;
  attemptsMade: number;
  maxAttempts: number;
  correlationId: string;
  error: DeadLetterErrorContext;
  failedAt: string;
  replayedAt?: string;
}

/**
 * Minimal shape of a failed job as surfaced by the queue transport.
 */
export interface FailedJob<T = unknown> {
  id?: string | number;
  name?: string;
  data: T;
  attemptsMade?: number;
  opts?: { attempts?: number };
  failedReason?: string;
  stacktrace?: string[];
}

const MAX_MESSAGE_LENGTH = 1024;
const MAX_STACK_LENGTH = 4096;

/**
 * Routes failed queue messages to durable dead-letter storage once they have
 * exhausted their bounded retry budget. Records carry safe error context and
 * correlation IDs so operators can inspect and replay eligible messages.
 */
@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);
  private readonly records = new Map<string, DeadLetterRecord>();

  /**
   * Persist a failed job to dead-letter storage. Returns the stored record, or
   * null when the job still has retry attempts remaining (poison messages stop
   * retrying only after the configured limit is reached).
   */
  async route<T = unknown>(
    queue: string,
    job: FailedJob<T>,
    correlationId?: string,
  ): Promise<DeadLetterRecord<T> | null> {
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? 1;

    if (attemptsMade < maxAttempts) {
      this.logger.warn(
        `Job ${job.id ?? 'unknown'} on ${queue} failed (attempt ${attemptsMade}/${maxAttempts}); will retry`,
      );
      return null;
    }

    const record: DeadLetterRecord<T> = {
      id: String(job.id ?? `${queue}:${Date.now()}`),
      queue,
      jobName: job.name ?? 'unknown',
      payload: job.data,
      attemptsMade,
      maxAttempts,
      correlationId: correlationId ?? this.extractCorrelationId(job.data),
      error: this.sanitizeError(job),
      failedAt: new Date().toISOString(),
    };

    this.records.set(record.id, record);
    this.logger.error(
      `Dead-lettered job ${record.id} on ${queue} after ${attemptsMade} attempt(s) [correlationId=${record.correlationId}]`,
    );
    return record;
  }

  /** List dead-lettered records, optionally scoped to a single queue. */
  list(queue?: string): DeadLetterRecord[] {
    const all = Array.from(this.records.values());
    return queue ? all.filter((record) => record.queue === queue) : all;
  }

  /** Fetch a single dead-lettered record by id. */
  get(id: string): DeadLetterRecord | undefined {
    return this.records.get(id);
  }

  /**
   * Mark a dead-lettered record as replayed so operators can re-enqueue it.
   * Returns the record, or null when it is unknown or already replayed.
   */
  replay(id: string): DeadLetterRecord | null {
    const record = this.records.get(id);
    if (!record || record.replayedAt) {
      return null;
    }
    record.replayedAt = new Date().toISOString();
    this.records.set(id, record);
    this.logger.log(`Replaying dead-lettered job ${id} on ${record.queue}`);
    return record;
  }

  private extractCorrelationId(data: unknown): string {
    if (data && typeof data === 'object') {
      const candidate = (data as Record<string, unknown>).correlationId;
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }
    return 'unknown';
  }

  private sanitizeError(job: FailedJob): DeadLetterErrorContext {
    const message = (job.failedReason ?? 'Unknown failure').slice(0, MAX_MESSAGE_LENGTH);
    const stack = job.stacktrace?.join('\n').slice(0, MAX_STACK_LENGTH);
    return {
      name: 'JobFailure',
      message,
      ...(stack ? { stack } : {}),
    };
  }
}
