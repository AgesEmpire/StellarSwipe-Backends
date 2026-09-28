import { StellarSwipeClient } from '../client';
import { RequestOptions } from '../types';

// ── Request / response types ──────────────────────────────────────────────────

export interface SimulateContractParams {
  /** Soroban contract ID (StrKey C… address) */
  contractId: string;
  /** Contract method / function name to invoke */
  method: string;
  /**
   * Arguments for the contract call. Each element is a JS value that the
   * server will convert to ScVal before running the simulation.
   */
  params?: unknown[];
  /** Source account public key for simulation context */
  sourceAccount?: string;
  /**
   * Source secret key — used only to build the tx envelope for simulation;
   * the transaction is **never** broadcast to the network.
   */
  sourceSecret?: string;
  /** RPC call timeout in milliseconds */
  timeoutMs?: number;
}

export interface SimulateContractResult {
  /** Whether the simulation succeeded without contract-level errors */
  success: boolean;

  /** Estimated resource fee in stroops */
  resourceFee?: string;
  /** Minimum resource fee in stroops (lower bound) */
  minResourceFee?: string;
  /** Recommended inclusion (base) fee in stroops */
  inclusionFee?: string;
  /**
   * Total estimated fee (inclusionFee + resourceFee) in stroops.
   * Pass this as the `fee` when building the real transaction.
   */
  totalFee?: string;

  /** Simulated contract return value (native JS representation) */
  result?: unknown;

  /**
   * Ledger footprint data. Pass `readOnly` and `readWrite` back when
   * building the real transaction so Soroban doesn't need a second preflight.
   */
  footprint?: {
    readOnly?: string[];
    readWrite?: string[];
  };

  /**
   * Authorization entries (base64 XDR) required by the contract call.
   * Include these in the real transaction to avoid a round-trip preflight.
   */
  auth?: string[];

  /**
   * Set when `success=false` and the contract itself would revert
   * (e.g. assertion failure, insufficient balance).
   * Distinct from `rpcError`.
   */
  simulationError?: string;

  /**
   * Set when `success=false` due to an RPC connectivity or protocol error.
   * Distinct from `simulationError`.
   */
  rpcError?: string;
}

// ── Resource class ────────────────────────────────────────────────────────────

/**
 * `Soroban` resource — exposes Soroban-specific operations on the
 * StellarSwipe backend, currently:
 *
 *   - `simulate()` — preflight a contract call for fee estimation without
 *     broadcasting the transaction.
 *
 * @example
 * ```ts
 * const client = new StellarSwipeClient({ apiKey: 'sk_…' });
 *
 * const result = await client.soroban.simulate({
 *   contractId: 'CABC…',
 *   method: 'execute_market_order',
 *   params: [userAddress, 'XLM', 'USDC', 100_000_000n, 50, 'buy'],
 * });
 *
 * if (result.success) {
 *   console.log('Estimated total fee (stroops):', result.totalFee);
 *   // build the real tx using result.footprint and result.auth …
 * } else if (result.simulationError) {
 *   console.error('Contract would revert:', result.simulationError);
 * } else {
 *   console.error('RPC error:', result.rpcError);
 * }
 * ```
 */
export class Soroban {
  constructor(private readonly client: StellarSwipeClient) {}

  /**
   * Preflight a Soroban contract call for fee estimation.
   *
   * Calls `POST /soroban/simulate` — the server runs `simulateTransaction`
   * via Soroban RPC and returns the estimated resource fee, minimum resource
   * fee, simulated result, and ledger footprint **without** submitting the
   * transaction on-chain.
   *
   * Use the returned `totalFee`, `footprint`, and `auth` values to build and
   * submit the real transaction with the correct resource budget.
   *
   * **Error semantics**
   * - `success: false` + `simulationError` — the contract itself would revert
   * - `success: false` + `rpcError` — RPC was unreachable or returned a
   *   protocol error (distinct from a contract revert)
   */
  async simulate(
    params: SimulateContractParams,
    options?: RequestOptions,
  ): Promise<SimulateContractResult> {
    return this.client.request<SimulateContractResult>(
      'POST',
      '/soroban/simulate',
      params,
      options,
    );
  }
}
