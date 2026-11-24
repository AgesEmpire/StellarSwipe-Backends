import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Ledger-based validity window for assembled Stellar transactions (#1511).
 *
 * Terminology
 * - `lastValidLedger` is the LAST ledger sequence that may still include the
 *   envelope (inclusive). Stellar's `LedgerBounds.maxLedger` precondition is
 *   exclusive (`ledgerSeq < maxLedger`), so `lastValidLedger = maxLedger - 1`.
 * - `latestLedger` is the most recently CLOSED ledger reported by RPC. The
 *   earliest ledger that can include a submission is `latestLedger + 1`.
 *
 * An envelope is therefore submit-ready only while `latestLedger < lastValidLedger`.
 * Once `latestLedger >= lastValidLedger` no future ledger can include it and
 * it must be rebuilt and re-signed rather than retried.
 */

/** Stable error code returned to clients for expired envelopes. */
export const TX_ENVELOPE_EXPIRED = 'TX_ENVELOPE_EXPIRED';

/** Ledgers an assembled transaction stays submit-ready for (~60s at ~5s/ledger). */
export const DEFAULT_VALIDITY_WINDOW_LEDGERS = 12;

export enum TransactionValidityStatus {
  /** At least one future ledger can still include the envelope. */
  VALID = 'VALID',
  /** No future ledger can include the envelope; do not submit or retry. */
  EXPIRED = 'EXPIRED',
  /** Boundary or current ledger not known; the network remains the arbiter. */
  UNKNOWN = 'UNKNOWN',
}

export interface TransactionValidity {
  status: TransactionValidityStatus;
  latestLedger: number | null;
  lastValidLedger: number | null;
  /** Ledgers that may still close and include the envelope (0 once expired). */
  ledgersRemaining: number | null;
}

const isKnownLedger = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/** Converts an exclusive `LedgerBounds.maxLedger` into an inclusive last-valid ledger. */
export function lastValidLedgerFromBounds(
  bounds: { minLedger?: number; maxLedger?: number } | null | undefined,
): number | null {
  if (!bounds || !isKnownLedger(bounds.maxLedger)) return null; // 0 = unbounded
  return bounds.maxLedger - 1;
}

/** Computes the last-valid ledger for an envelope assembled now. */
export function lastValidLedgerForWindow(
  latestLedger: number | null | undefined,
  windowLedgers = DEFAULT_VALIDITY_WINDOW_LEDGERS,
): number | null {
  if (!isKnownLedger(latestLedger)) return null;
  return latestLedger + windowLedgers;
}

export function classifyTransactionValidity(
  lastValidLedger: number | null | undefined,
  latestLedger: number | null | undefined,
): TransactionValidity {
  const lastValid = isKnownLedger(lastValidLedger) ? lastValidLedger : null;
  const latest = isKnownLedger(latestLedger) ? latestLedger : null;

  if (lastValid === null || latest === null) {
    return {
      status: TransactionValidityStatus.UNKNOWN,
      latestLedger: latest,
      lastValidLedger: lastValid,
      ledgersRemaining: null,
    };
  }

  const remaining = lastValid - latest;
  return {
    status:
      remaining > 0
        ? TransactionValidityStatus.VALID
        : TransactionValidityStatus.EXPIRED,
    latestLedger: latest,
    lastValidLedger: lastValid,
    ledgersRemaining: Math.max(remaining, 0),
  };
}

export class TransactionEnvelopeExpiredException extends UnprocessableEntityException {
  readonly code = TX_ENVELOPE_EXPIRED;

  constructor(readonly validity: TransactionValidity) {
    super({
      statusCode: 422,
      code: TX_ENVELOPE_EXPIRED,
      message:
        'Transaction envelope has passed its last valid ledger and was not submitted. Rebuild and re-sign it before retrying.',
      lastValidLedger: validity.lastValidLedger,
      latestLedger: validity.latestLedger,
    });
  }
}

/**
 * Guard to call immediately before broadcasting. Throws (and so prevents
 * submission) only when expiry is certain; UNKNOWN is allowed through.
 */
export function assertEnvelopeSubmittable(
  lastValidLedger: number | null | undefined,
  latestLedger: number | null | undefined,
): TransactionValidity {
  const validity = classifyTransactionValidity(lastValidLedger, latestLedger);
  if (validity.status === TransactionValidityStatus.EXPIRED) {
    throw new TransactionEnvelopeExpiredException(validity);
  }
  return validity;
}
