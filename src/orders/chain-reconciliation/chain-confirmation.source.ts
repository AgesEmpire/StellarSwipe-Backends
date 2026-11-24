/**
 * What one authoritative source (e.g. one Horizon endpoint) reported about a
 * transaction hash at a point in time. Persisted verbatim as reconciliation
 * evidence, so keep it plain JSON.
 */
export interface ChainObservation {
  /** Identifies the source, e.g. the Horizon base URL. */
  source: string;
  /**
   * success   – transaction is in a closed ledger and succeeded
   * failed    – transaction is in a closed ledger and failed
   * not_found – source answered authoritatively that it does not know the hash
   * error     – source could not answer (network/5xx/timeout); carries no information
   */
  outcome: 'success' | 'failed' | 'not_found' | 'error';
  /** Hash echoed back by the source, when it returned a record. */
  hash?: string;
  ledger?: number;
  resultCode?: string;
  feeCharged?: string;
  error?: string;
  observedAt: string;
}

export interface ChainConfirmationSource {
  /** Returns one observation per configured source. Must not throw for per-source failures. */
  lookup(txHash: string): Promise<ChainObservation[]>;
}

export const CHAIN_CONFIRMATION_SOURCE = Symbol('CHAIN_CONFIRMATION_SOURCE');
