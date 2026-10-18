import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';
import { StellarConfigService } from '../../config/stellar.service';
import { CircuitBreakerService } from '../../http/circuit-breaker.service';
import {
  HorizonEndpointHealth,
  HorizonEndpointSelectorService,
} from './horizon-endpoint-selector.service';

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
 *
 * #1373 — Each call additionally goes through HorizonEndpointSelectorService
 * to pick among the configured Horizon endpoints (`STELLAR_HORIZON_URLS`),
 * avoiding ones currently reported unhealthy and letting recovered ones
 * rejoin. This only ever changes which Horizon URL is hit for the request;
 * `network` / `networkPassphrase` always come from `StellarConfigService`
 * and are never affected by endpoint selection, so failover can't silently
 * move a caller onto a different Stellar network.
 */
@Injectable()
export class StellarProviderService {
  private readonly logger = new Logger(StellarProviderService.name);
  private readonly servers = new Map<string, StellarSdk.Horizon.Server>();

  constructor(
    private readonly stellarConfig: StellarConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly endpointSelector: HorizonEndpointSelectorService,
  ) {}

  /** Load account data — uses the read circuit. */
  async loadAccount(publicKey: string): Promise<StellarSdk.AccountResponse> {
    return this.executeWithFailover(CIRCUIT_READ, (server) =>
      server.loadAccount(publicKey),
    );
  }

  /** Fetch the latest ledger sequence — uses the read circuit. */
  async fetchLatestLedger(): Promise<number> {
    return this.executeWithFailover(CIRCUIT_READ, async (server) => {
      const ledgers = await server.ledgers().order('desc').limit(1).call();
      return ledgers.records[0].sequence;
    });
  }

  /** Submit a signed transaction envelope — uses the write circuit. */
  async submitTransaction(
    transaction: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction,
  ): Promise<StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse> {
    return this.executeWithFailover(
      CIRCUIT_WRITE,
      (server) => server.submitTransaction(transaction),
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

  /** Expose current Horizon endpoint health for health checks / metrics endpoints. */
  getEndpointHealth(): HorizonEndpointHealth[] {
    return this.endpointSelector.getStatus();
  }

  /**
   * Selects a Horizon endpoint, runs `fn` against it through the named
   * circuit breaker, and reports the outcome back to the endpoint selector
   * so unhealthy endpoints are avoided on subsequent calls and recovered
   * ones rejoin the rotation.
   */
  private async executeWithFailover<T>(
    circuit: string,
    fn: (server: StellarSdk.Horizon.Server) => Promise<T>,
    circuitOptions?: Parameters<CircuitBreakerService['execute']>[2],
  ): Promise<T> {
    const url = this.endpointSelector.selectEndpoint();
    const server = this.serverFor(url);

    return this.circuitBreaker.execute(
      circuit,
      async () => {
        try {
          const result = await fn(server);
          this.endpointSelector.reportSuccess(url);
          return result;
        } catch (error) {
          this.endpointSelector.reportFailure(url);
          throw error;
        }
      },
      circuitOptions,
    );
  }

  private serverFor(url: string): StellarSdk.Horizon.Server {
    let server = this.servers.get(url);
    if (!server) {
      server = new StellarSdk.Horizon.Server(url);
      this.servers.set(url, server);
    }
    return server;
  }
}
