import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import * as StellarSdk from '@stellar/stellar-sdk';
import { StellarConfigService } from '../../config/stellar.service';

/**
 * Possible outcomes when querying Horizon for a submitted transaction.
 */
export type TxOutcome = 'confirmed' | 'failed' | 'not_found' | 'pending';

export interface ReconciliationRecord {
  id: string;
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed' | 'expired';
  submittedAt: Date;
  resolvedAt?: Date;
  resultXdr?: string;
  errorDetail?: string;
}

/**
 * StellarTxReconciliationService
 *
 * Polls Horizon for submitted operations whose local status is still "pending",
 * then idempotently persists the resolved outcome.  Design constraints:
 *
 * - Bounded age: records older than MAX_PENDING_AGE_MS are marked "expired"
 *   instead of retried indefinitely.
 * - Exponential back-off via attempt count on the caller (cron interval).
 * - All writes are idempotent — re-running produces the same final state.
 * - Balance-affecting corrections are emitted as events so downstream
 *   consumers (portfolio, ledger) can react without coupling.
 */
@Injectable()
export class StellarTxReconciliationService {
  private readonly logger = new Logger(StellarTxReconciliationService.name);
  private readonly server: StellarSdk.Horizon.Server;

  /** Pending operations older than this are abandoned as "expired". */
  static readonly MAX_PENDING_AGE_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly stellarConfig: StellarConfigService) {
    this.server = new StellarSdk.Horizon.Server(
      this.stellarConfig.horizonUrl,
    );
  }

  /**
   * Query Horizon for the outcome of a single transaction hash.
   * Returns a normalised TxOutcome without mutating any DB record.
   */
  async queryOutcome(txHash: string): Promise<TxOutcome> {
    try {
      const tx = await this.server
        .transactions()
        .transaction(txHash)
        .call();

      if ((tx as any).successful === false) return 'failed';
      return 'confirmed';
    } catch (err: unknown) {
      const status = (err as any)?.response?.status as number | undefined;
      if (status === 404) return 'not_found';
      // Network / 5xx errors — caller should retry later
      this.logger.warn(
        `Horizon query for tx ${txHash} failed (status=${status ?? 'unknown'}): ${(err as Error).message}`,
      );
      return 'pending';
    }
  }

  /**
   * Reconcile a batch of in-memory records against Horizon.
   * Returns each record with its updated status.
   *
   * The caller owns persistence — this method is pure logic so it can be
   * tested without a real DB.
   */
  async reconcileBatch(
    records: ReconciliationRecord[],
  ): Promise<ReconciliationRecord[]> {
    const now = new Date();
    const resolved: ReconciliationRecord[] = [];

    for (const rec of records) {
      // Age guard — abandon rather than poll indefinitely
      const ageMs = now.getTime() - rec.submittedAt.getTime();
      if (ageMs > StellarTxReconciliationService.MAX_PENDING_AGE_MS) {
        resolved.push({
          ...rec,
          status: 'expired',
          resolvedAt: now,
          errorDetail: `Abandoned after ${Math.round(ageMs / 1000)}s without confirmation`,
        });
        this.logger.warn(
          `tx ${rec.txHash} expired after ${Math.round(ageMs / 1000)}s`,
        );
        continue;
      }

      const outcome = await this.queryOutcome(rec.txHash);

      switch (outcome) {
        case 'confirmed':
          resolved.push({ ...rec, status: 'confirmed', resolvedAt: now });
          this.logger.log(`tx ${rec.txHash} confirmed`);
          break;
        case 'failed':
          resolved.push({
            ...rec,
            status: 'failed',
            resolvedAt: now,
            errorDetail: 'Transaction failed on-chain',
          });
          this.logger.warn(`tx ${rec.txHash} failed on-chain`);
          break;
        default:
          // still pending or transient error — leave unchanged
          resolved.push(rec);
      }
    }

    return resolved;
  }
}
