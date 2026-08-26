import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';
import { StellarConfigService } from '../../config/stellar.service';
import { CircuitBreakerService } from '../../http/circuit-breaker.service';

/** Named circuits — one per logical operation category. */
const CIRCUIT_READ = 'stellar-horizon-read';
const CIRCUIT_WRITE = 'stellar-horizon-write';

/**
 * StellarProviderService
 *
 * Wraps raw Horizon SDK calls with the existing CircuitBreakerService so that:
 * - Read operations (account, transactions, offers) fail-fast when Horizon
 *   is unavailable, returning a ServiceUnavailableException immediately.
 * - Write operations (transaction submission) also protect workers but do
 *   NOT silently swallow errors — callers receive the exception and can
 *   persist the hash for later reconciliation.
 *
 * Circuit thresholds (defaults from CircuitBreakerService):
 *   - Opens after 5 consecutive failures
 *   - Probes recovery after 30 s
 *   - Closes after 2 consecutive successful probes
 */
@Injectable()
export class StellarProviderService {
  private readonly logger = new Logger(StellarProviderService.name);
  private readonly server: StellarSdk.Horizon.Server;

  constructor(
    private readonly stellarConfig: StellarConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {
    this.server = new StellarSdk.Horizon.Server(
      this.stellarConfig.horizonUrl,
    );
  }

  /** Load account data — uses the read circuit. */
  async loadAccount(publicKey: string): Promise<StellarSdk.AccountResponse> {
    return this.circuitBreaker.execute(
      CIRCUIT_READ,
      () => this.server.loadAccount(publicKey),
    );
  }

  /** Fetch the latest ledger sequence — uses the read circuit. */
  async fetchLatestLedger(): Promise<number> {
    return this.circuitBreaker.execute(CIRCUIT_READ, async () => {
      const ledgers = await this.server.ledgers().order('desc').limit(1).call();
      return ledgers.records[0].sequence;
    });
  }

  /** Submit a signed transaction envelope — uses the write circuit. */
  async submitTransaction(
    transaction: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction,
  ): Promise<StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse> {
    return this.circuitBreaker.execute(
      CIRCUIT_WRITE,
      () => this.server.submitTransaction(transaction),
      // Write operations use a slightly higher failure threshold so transient
      // network blips don't prematurely block submissions.
      { failureThreshold: 8, recoveryTimeMs: 60_000 },
    );
  }

  /** Expose current circuit states for health checks / metrics endpoints. */
  getCircuitStates(): { read: string; write: string } {
    return {
      read: this.circuitBreaker.getState(CIRCUIT_READ),
      write: this.circuitBreaker.getState(CIRCUIT_WRITE),
    };
  }
}
