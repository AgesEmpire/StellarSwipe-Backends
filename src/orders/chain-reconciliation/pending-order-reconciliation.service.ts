import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, LessThan, Not, QueryFailedError, Repository } from 'typeorm';
import { Trade, TradeStatus } from '../../trades/entities/trade.entity';
import { TradeFailureCode } from '../../trades/errors/trade-failure-codes';
import { OutboxService } from '../../events/outbox/outbox.service';
import { CHAIN_CONFIRMATION_SOURCE, ChainConfirmationSource, ChainObservation } from './chain-confirmation.source';
import {
  OrderReconciliationEvidence,
  OrderReconciliationReview,
  ReconciliationResolution,
  ReconciliationReviewStatus,
} from './order-reconciliation.entity';
import {
  RECONCILIATION_POLICY_VERSION,
  ReconciliationDecision,
  ReconciliationPolicyConfig,
  decideReconciliation,
} from './reconciliation-policy';

/** Local statuses that mean "submitted, outcome not yet known". */
export const RECONCILABLE_STATUSES: TradeStatus[] = [TradeStatus.PENDING, TradeStatus.EXECUTING];

export const SYSTEM_ACTOR = 'system';

export type ReconciliationOutcome =
  | 'confirmed'
  | 'failed'
  | 'flagged_for_review'
  | 'deferred'
  | 'awaiting_review'
  | 'skipped';

export interface ReconciliationItemResult {
  tradeId: string;
  outcome: ReconciliationOutcome;
  rule: string;
  detail?: string;
}

export interface ReconciliationRunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  policyVersion: string;
  examined: number;
  confirmed: number;
  failed: number;
  flaggedForReview: number;
  deferred: number;
  awaitingReview: number;
  skipped: number;
  items: ReconciliationItemResult[];
}

export interface ReconcileOptions {
  limit?: number;
  /** Only look at orders submitted at least this long ago (lets the normal confirmation path go first). */
  minAgeMs?: number;
  now?: Date;
}

export interface ResolveReviewInput {
  decision: 'confirm' | 'fail' | 'dismiss';
  note: string;
}

const UNIQUE_VIOLATION = '23505';
const isUniqueViolation = (e: unknown) =>
  e instanceof QueryFailedError && (e as any).driverError?.code === UNIQUE_VIOLATION;

/**
 * Reconciles orders stuck in a pending state against authoritative Stellar
 * confirmations (#1531).
 *
 * - Safe to rerun: every transition re-reads the order under a row lock and
 *   only applies when it is still pending with the same tx hash; anything
 *   already resolved is skipped. Reviews are deduplicated per order.
 * - Every state change writes an immutable evidence row (observations, rule,
 *   policy version, actor) in the same transaction as the change.
 * - Contradictory or ambiguous chain results are never guessed: they open a
 *   review and the order stays pending until an operator resolves it.
 */
@Injectable()
export class PendingOrderReconciliationService {
  private readonly logger = new Logger(PendingOrderReconciliationService.name);
  private running = false;

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    @InjectRepository(OrderReconciliationEvidence)
    private readonly evidenceRepo: Repository<OrderReconciliationEvidence>,
    @InjectRepository(OrderReconciliationReview)
    private readonly reviewRepo: Repository<OrderReconciliationReview>,
    private readonly dataSource: DataSource,
    @Inject(CHAIN_CONFIRMATION_SOURCE)
    private readonly chain: ChainConfirmationSource,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
  ) {}

  get policyConfig(): ReconciliationPolicyConfig {
    return {
      missingGraceMs: Number(this.config.get('ORDER_RECONCILIATION_MISSING_GRACE_MS', 30 * 60 * 1000)),
    };
  }

  /** Scheduled entry point: skips if a run is already in progress in this process. */
  async runIfIdle(): Promise<ReconciliationRunSummary | null> {
    if (this.running) {
      this.logger.debug('Reconciliation already running; skipping');
      return null;
    }
    this.running = true;
    try {
      return await this.reconcile();
    } finally {
      this.running = false;
    }
  }

  async reconcile(options: ReconcileOptions = {}): Promise<ReconciliationRunSummary> {
    const now = options.now ?? new Date();
    const runId = randomUUID();
    const limit = Math.min(Math.max(options.limit ?? Number(this.config.get('ORDER_RECONCILIATION_BATCH_SIZE', 100)), 1), 500);
    const minAgeMs = options.minAgeMs ?? Number(this.config.get('ORDER_RECONCILIATION_MIN_AGE_MS', 2 * 60 * 1000));

    const candidates = await this.tradeRepo.find({
      where: {
        status: In(RECONCILABLE_STATUSES),
        transactionHash: Not(IsNull()),
        createdAt: LessThan(new Date(now.getTime() - minAgeMs)),
      },
      order: { createdAt: 'ASC' },
      take: limit,
    });

    const items: ReconciliationItemResult[] = [];
    for (const trade of candidates) {
      try {
        items.push(await this.reconcileOne(trade, runId, now));
      } catch (error) {
        this.logger.error(`Reconciliation of order ${trade.id} errored: ${(error as Error).message}`);
        items.push({ tradeId: trade.id, outcome: 'deferred', rule: 'E1_internal_error', detail: (error as Error).message });
      }
    }

    const count = (o: ReconciliationOutcome) => items.filter((i) => i.outcome === o).length;
    const summary: ReconciliationRunSummary = {
      runId,
      startedAt: now.toISOString(),
      finishedAt: new Date().toISOString(),
      policyVersion: RECONCILIATION_POLICY_VERSION,
      examined: candidates.length,
      confirmed: count('confirmed'),
      failed: count('failed'),
      flaggedForReview: count('flagged_for_review'),
      deferred: count('deferred'),
      awaitingReview: count('awaiting_review'),
      skipped: count('skipped'),
      items,
    };
    this.logger.log(
      `Reconciliation run ${runId}: examined=${summary.examined} confirmed=${summary.confirmed} failed=${summary.failed} review=${summary.flaggedForReview} deferred=${summary.deferred}`,
    );
    return summary;
  }

  private async reconcileOne(trade: Trade, runId: string, now: Date): Promise<ReconciliationItemResult> {
    const txHash = trade.transactionHash as string;
    const observations = await this.chain.lookup(txHash);
    const decision = decideReconciliation(
      { txHash, localLedger: trade.ledger, submittedAt: trade.createdAt, now, observations },
      this.policyConfig,
    );

    if (decision.action === 'defer') {
      return { tradeId: trade.id, outcome: 'deferred', rule: decision.rule, detail: decision.detail };
    }

    const openReview = await this.reviewRepo.findOne({
      where: { tradeId: trade.id, status: ReconciliationReviewStatus.OPEN },
    });

    if (decision.action === 'review') {
      await this.flagForReview(trade, decision, observations, runId, openReview);
      return { tradeId: trade.id, outcome: 'flagged_for_review', rule: decision.rule, detail: decision.detail };
    }

    // Once a human has been asked to decide, automation does not pre-empt them.
    if (openReview) {
      return { tradeId: trade.id, outcome: 'awaiting_review', rule: decision.rule, detail: `Review ${openReview.id} is open` };
    }

    const applied = await this.dataSource.transaction((manager) =>
      this.applyTransition(manager, {
        tradeId: trade.id,
        txHash,
        decision,
        observations,
        runId,
        actorId: SYSTEM_ACTOR,
      }),
    );
    if (!applied) {
      return { tradeId: trade.id, outcome: 'skipped', rule: decision.rule, detail: 'Order no longer pending' };
    }
    return { tradeId: trade.id, outcome: decision.action === 'confirm' ? 'confirmed' : 'failed', rule: decision.rule };
  }

  /**
   * Locks the order and applies a confirm/fail transition plus its evidence.
   * Returns false (no-op) if the order is no longer pending or its hash
   * changed since it was read — which is what makes reruns safe.
   */
  private async applyTransition(
    manager: EntityManager,
    params: {
      tradeId: string;
      txHash: string;
      decision: Extract<ReconciliationDecision, { action: 'confirm' | 'fail' }>;
      observations: ChainObservation[];
      runId: string | null;
      actorId: string;
      note?: string;
    },
  ): Promise<boolean> {
    const trade = await manager.findOne(Trade, { where: { id: params.tradeId }, lock: { mode: 'pessimistic_write' } });
    if (!trade || !RECONCILABLE_STATUSES.includes(trade.status) || trade.transactionHash !== params.txHash) {
      return false;
    }

    const fromStatus = trade.status;
    const { decision } = params;
    if (decision.action === 'confirm') {
      trade.status = TradeStatus.CONFIRMED;
      if (decision.ledger !== undefined) trade.ledger = decision.ledger;
      trade.executedAt = trade.executedAt ?? new Date();
    } else {
      trade.status = TradeStatus.FAILED;
      if (decision.ledger !== undefined) trade.ledger = decision.ledger;
      trade.failureCode = TradeFailureCode.PROVIDER_REJECTED;
      trade.errorMessage = `Transaction failed on-chain${decision.resultCode ? ` (${decision.resultCode})` : ''}`;
    }
    trade.version = (trade.version ?? 1) + 1;
    await manager.save(Trade, trade);

    await manager.insert(OrderReconciliationEvidence, {
      tradeId: trade.id,
      runId: params.runId,
      txHash: params.txHash,
      fromStatus,
      toStatus: trade.status,
      rule: decision.rule,
      policyVersion: RECONCILIATION_POLICY_VERSION,
      actorId: params.actorId,
      note: params.note ?? null,
      observations: params.observations,
    });

    await this.outbox.record(
      manager,
      'trade.reconciled',
      { tradeId: trade.id, userId: trade.userId, fromStatus, toStatus: trade.status, rule: decision.rule },
      `trade.reconciled:${trade.id}:${trade.status}`,
    );
    return true;
  }

  private async flagForReview(
    trade: Trade,
    decision: Extract<ReconciliationDecision, { action: 'review' }>,
    observations: ChainObservation[],
    runId: string,
    openReview: OrderReconciliationReview | null,
  ): Promise<void> {
    if (openReview) {
      await this.reviewRepo.update(
        { id: openReview.id, status: ReconciliationReviewStatus.OPEN },
        {
          reason: decision.reason,
          detail: decision.detail,
          observations,
          lastRunId: runId,
          occurrences: openReview.occurrences + 1,
        },
      );
      return;
    }
    try {
      await this.reviewRepo.insert({
        tradeId: trade.id,
        txHash: trade.transactionHash as string,
        reason: decision.reason,
        detail: decision.detail,
        status: ReconciliationReviewStatus.OPEN,
        observations,
        firstRunId: runId,
        lastRunId: runId,
        occurrences: 1,
      });
      this.logger.warn(`Order ${trade.id} flagged for review: ${decision.reason} — ${decision.detail}`);
    } catch (error) {
      // A concurrent run opened the review first (partial unique index).
      if (!isUniqueViolation(error)) throw error;
    }
  }

  // ─── Operator workflow ─────────────────────────────────────────────────────

  listReviews(status: ReconciliationReviewStatus = ReconciliationReviewStatus.OPEN): Promise<OrderReconciliationReview[]> {
    return this.reviewRepo.find({ where: { status }, order: { createdAt: 'ASC' }, take: 200 });
  }

  listEvidence(tradeId: string): Promise<OrderReconciliationEvidence[]> {
    return this.evidenceRepo.find({ where: { tradeId }, order: { createdAt: 'ASC' } });
  }

  /**
   * An operator decides an open review. confirm/fail applies the transition
   * with an evidence row attributed to the operator; dismiss closes the review
   * without changing the order (a later run may flag it again).
   */
  async resolveReview(reviewId: string, input: ResolveReviewInput, actorId: string): Promise<OrderReconciliationReview> {
    const note = input?.note?.trim();
    if (!note || note.length < 3) throw new BadRequestException('A resolution note is required');
    if (!['confirm', 'fail', 'dismiss'].includes(input.decision)) {
      throw new BadRequestException('decision must be confirm, fail or dismiss');
    }
    if (!actorId) throw new BadRequestException('An authenticated operator is required');

    return this.dataSource.transaction(async (manager) => {
      const review = await manager.findOne(OrderReconciliationReview, {
        where: { id: reviewId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!review) throw new NotFoundException(`Review ${reviewId} not found`);
      if (review.status !== ReconciliationReviewStatus.OPEN) {
        throw new ConflictException(`Review ${reviewId} is already resolved`);
      }

      if (input.decision !== 'dismiss') {
        const applied = await this.applyTransition(manager, {
          tradeId: review.tradeId,
          txHash: review.txHash,
          decision:
            input.decision === 'confirm'
              ? { action: 'confirm', rule: `operator_resolution:${review.reason}` }
              : { action: 'fail', rule: `operator_resolution:${review.reason}` },
          observations: review.observations,
          runId: null,
          actorId,
          note,
        });
        if (!applied) {
          throw new ConflictException(`Order ${review.tradeId} is no longer pending; dismiss the review instead`);
        }
      }

      review.status = ReconciliationReviewStatus.RESOLVED;
      review.resolution =
        input.decision === 'confirm'
          ? ReconciliationResolution.CONFIRMED
          : input.decision === 'fail'
            ? ReconciliationResolution.FAILED
            : ReconciliationResolution.DISMISSED;
      review.resolvedBy = actorId;
      review.resolutionNote = note;
      review.resolvedAt = new Date();
      return manager.save(OrderReconciliationReview, review);
    });
  }
}
