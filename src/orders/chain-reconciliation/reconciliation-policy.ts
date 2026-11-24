import { ChainObservation } from './chain-confirmation.source';

/** Bump when the rules below change, so stored evidence says which rules produced it. */
export const RECONCILIATION_POLICY_VERSION = '2026-11-23.1';

export enum ReviewReason {
  CONFLICTING_OUTCOMES = 'conflicting_outcomes',
  CONFLICTING_LEDGERS = 'conflicting_ledgers',
  LEDGER_MISMATCH_LOCAL = 'ledger_mismatch_local',
  HASH_MISMATCH = 'hash_mismatch',
  PARTIAL_VISIBILITY = 'partial_visibility',
  MISSING_BEYOND_GRACE = 'missing_beyond_grace',
}

export interface ReconciliationPolicyConfig {
  /**
   * How long a submitted transaction may stay unknown to every source (or
   * visible to only some) before we stop waiting and ask an operator.
   */
  missingGraceMs: number;
}

export interface ReconciliationInput {
  txHash: string;
  /** Ledger already recorded locally for this order, if any. */
  localLedger?: number | null;
  submittedAt: Date;
  now: Date;
  observations: ChainObservation[];
}

export type ReconciliationDecision =
  | { action: 'confirm'; rule: string; ledger?: number; feeCharged?: string }
  | { action: 'fail'; rule: string; ledger?: number; resultCode?: string }
  | { action: 'review'; rule: string; reason: ReviewReason; detail: string }
  | { action: 'defer'; rule: string; detail: string };

/**
 * Explicit, side-effect-free transition rules for a pending order whose
 * transaction hash is known (#1531).
 *
 * The policy never guesses: it only confirms or fails an order when every
 * source that answered agrees on a decisive outcome. Disagreement, a hash or
 * ledger that doesn't match, or a transaction that stays invisible past the
 * grace period is surfaced for review. Transient source errors carry no
 * information and simply defer the decision to a later run.
 */
export function decideReconciliation(
  input: ReconciliationInput,
  config: ReconciliationPolicyConfig,
): ReconciliationDecision {
  const answered = input.observations.filter((o) => o.outcome !== 'error');
  if (answered.length === 0) {
    return {
      action: 'defer',
      rule: 'R1_no_authoritative_answer',
      detail: input.observations.length ? 'All sources errored' : 'No sources configured',
    };
  }

  const mismatched = answered.filter((o) => o.hash && o.hash.toLowerCase() !== input.txHash.toLowerCase());
  if (mismatched.length) {
    return {
      action: 'review',
      rule: 'R2_hash_mismatch',
      reason: ReviewReason.HASH_MISMATCH,
      detail: `Source(s) ${mismatched.map((o) => o.source).join(', ')} returned a different hash`,
    };
  }

  const successes = answered.filter((o) => o.outcome === 'success');
  const failures = answered.filter((o) => o.outcome === 'failed');
  const missing = answered.filter((o) => o.outcome === 'not_found');
  const ageMs = input.now.getTime() - input.submittedAt.getTime();
  const pastGrace = ageMs >= config.missingGraceMs;

  if (successes.length && failures.length) {
    return {
      action: 'review',
      rule: 'R3_conflicting_outcomes',
      reason: ReviewReason.CONFLICTING_OUTCOMES,
      detail: `success from ${successes.map((o) => o.source).join(', ')}; failed from ${failures.map((o) => o.source).join(', ')}`,
    };
  }

  const decisive = successes.length ? successes : failures;
  if (decisive.length) {
    const ledgers = [...new Set(decisive.map((o) => o.ledger).filter((l): l is number => l !== undefined))];
    if (ledgers.length > 1) {
      return {
        action: 'review',
        rule: 'R4_conflicting_ledgers',
        reason: ReviewReason.CONFLICTING_LEDGERS,
        detail: `Sources report ledgers ${ledgers.join(', ')}`,
      };
    }
    const ledger = ledgers[0];
    if (input.localLedger != null && ledger !== undefined && Number(input.localLedger) !== ledger) {
      return {
        action: 'review',
        rule: 'R5_ledger_mismatch_local',
        reason: ReviewReason.LEDGER_MISMATCH_LOCAL,
        detail: `Local ledger ${input.localLedger} but chain reports ${ledger}`,
      };
    }
    if (missing.length) {
      // Some sources see it, others don't (ingestion lag or a fork in what
      // nodes know). Wait for agreement; escalate if it never comes.
      return pastGrace
        ? {
            action: 'review',
            rule: 'R6_partial_visibility_past_grace',
            reason: ReviewReason.PARTIAL_VISIBILITY,
            detail: `Not found on ${missing.map((o) => o.source).join(', ')} after ${Math.round(ageMs / 1000)}s`,
          }
        : { action: 'defer', rule: 'R6_partial_visibility', detail: 'Waiting for all sources to agree' };
    }
    if (successes.length) {
      return { action: 'confirm', rule: 'R7_all_sources_success', ledger, feeCharged: successes[0].feeCharged };
    }
    return { action: 'fail', rule: 'R8_all_sources_failed', ledger, resultCode: failures[0].resultCode };
  }

  // Every source that answered says "not found".
  return pastGrace
    ? {
        action: 'review',
        rule: 'R9_missing_past_grace',
        reason: ReviewReason.MISSING_BEYOND_GRACE,
        detail: `Not found on any source after ${Math.round(ageMs / 1000)}s`,
      }
    : { action: 'defer', rule: 'R9_awaiting_inclusion', detail: 'Not yet visible on any source' };
}
