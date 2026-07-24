import { OnQueueFailed, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';

/**
 * Dead-letter handling for the `transactions` queue.
 *
 * `check-statuses` cycles are configured with a bounded number of attempts
 * (see monitor-transactions.job.ts). When a cycle exhausts every attempt —
 * e.g. Horizon/Soroban RPC is down for an extended period — this fires once
 * with the final failure, giving operators a single, unambiguous signal
 * instead of the job silently vanishing (previous `removeOnFail: true`
 * behavior) or being missed among per-attempt failure logs.
 */
@Injectable()
@Processor('transactions')
export class TradeDlqProcessor {
  private readonly logger = new Logger(TradeDlqProcessor.name);

  @OnQueueFailed()
  onFailed(job: Job, error: Error): void {
    const maxAttempts = job.opts?.attempts ?? 1;

    if (job.attemptsMade < maxAttempts) {
      // Still has retries left — not dead-lettered yet, nothing to alert on.
      return;
    }

    this.logger.error(
      `[DLQ] Job "${job.name}" (id=${job.id}) exhausted all ${maxAttempts} attempts: ${error.message}`,
      error.stack,
    );
  }
}
