import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StellarTxReconciliationService } from './stellar-tx-reconciliation.service';
import { SubmittedOperation } from '../entities/submitted-operation.entity';

/** Max records processed per cron tick to prevent run-away batches. */
const BATCH_SIZE = 50;

/**
 * StellarTxReconciliationJob
 *
 * Scheduled job that polls Horizon for submitted operations whose local
 * status is still "pending".  Runs every minute; each run is bounded by
 * BATCH_SIZE so a burst of stuck operations cannot block the event loop.
 *
 * Idempotency guarantee: a confirmed/failed/expired write is a no-op on
 * re-run because the WHERE clause filters on status = 'pending'.
 */
@Injectable()
export class StellarTxReconciliationJob {
  private readonly logger = new Logger(StellarTxReconciliationJob.name);

  constructor(
    @InjectRepository(SubmittedOperation)
    private readonly opRepo: Repository<SubmittedOperation>,
    private readonly reconciler: StellarTxReconciliationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    const pending = await this.opRepo.find({
      where: { status: 'pending' },
      order: { submittedAt: 'ASC' },
      take: BATCH_SIZE,
    });

    if (pending.length === 0) return;

    this.logger.log(`Reconciling ${pending.length} pending operation(s)`);

    const resolved = await this.reconciler.reconcileBatch(
      pending.map((op) => ({
        id: op.id,
        txHash: op.txHash,
        status: op.status,
        submittedAt: op.submittedAt,
      })),
    );

    let updated = 0;
    for (const rec of resolved) {
      if (rec.status === pending.find((p) => p.id === rec.id)?.status) continue;

      await this.opRepo.update(rec.id, {
        status: rec.status,
        resolvedAt: rec.resolvedAt,
        errorDetail: rec.errorDetail,
      });
      updated++;
    }

    this.logger.log(
      `Reconciliation run complete — updated: ${updated}/${pending.length}`,
    );
  }
}
