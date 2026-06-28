/**
 * Categories of Horizon API calls that get their own isolated bulkhead.
 *
 * - READ: account loads, ledger/transaction/operation queries, streaming
 *   setup — high-volume, latency-tolerant.
 * - WRITE: transaction submission — lower volume, must not be blocked by a
 *   backlog of read calls (and vice versa).
 */
export enum HorizonCallCategory {
  READ = 'read',
  WRITE = 'write',
}
