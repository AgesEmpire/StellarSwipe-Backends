import { Injectable, Logger } from '@nestjs/common';
import { StellarConfigService } from '../../config/stellar.service';

/** Point-in-time health view of a single configured Horizon endpoint. */
export interface HorizonEndpointHealth {
  url: string;
  healthy: boolean;
  consecutiveFailures: number;
  markedUnhealthyAt?: Date;
}

/**
 * HorizonEndpointSelectorService
 *
 * #1373 — Selects among the configured Horizon endpoints
 * (`StellarConfigService.horizonUrls`) based on observed health, so a
 * single degraded Horizon instance doesn't take down every Stellar read/
 * write in the app.
 *
 * Importantly, this service only ever chooses *which URL* to call. It never
 * touches `network` or `networkPassphrase` — those stay fixed from config
 * regardless of which endpoint is selected, so failover can never silently
 * move traffic onto a different Stellar network. Operators are responsible
 * for only listing endpoints that serve the same configured network; this
 * service has no way to (and does not attempt to) verify that at runtime,
 * since Horizon's root resource is itself one of the calls that can fail.
 *
 * Selection policy:
 *  - Round-robins across currently-healthy endpoints.
 *  - `reportFailure` marks an endpoint unhealthy after `unhealthyThreshold`
 *    consecutive failures and removes it from the healthy rotation.
 *  - `reportSuccess` immediately clears an endpoint's failure count and, if
 *    it was unhealthy, rejoins it to the rotation ("recovered endpoints
 *    rejoin").
 *  - An unhealthy endpoint is still retried (not permanently abandoned)
 *    after `cooldownMs`, so it can prove itself healthy again; if all
 *    endpoints are currently unhealthy, selection fails open and tries the
 *    whole configured list rather than refusing outright.
 */
@Injectable()
export class HorizonEndpointSelectorService {
  private readonly logger = new Logger(HorizonEndpointSelectorService.name);
  private readonly endpoints: HorizonEndpointHealth[];
  private cursor = 0;

  /** Consecutive failures before an endpoint is marked unhealthy. */
  private readonly unhealthyThreshold = 3;
  /** How long an unhealthy endpoint sits out before being re-admitted for a probe. */
  private readonly cooldownMs = 60_000;

  constructor(private readonly stellarConfig: StellarConfigService) {
    this.endpoints = this.stellarConfig.horizonUrls.map((url) => ({
      url,
      healthy: true,
      consecutiveFailures: 0,
    }));
  }

  /**
   * Returns the next Horizon endpoint URL to use. Round-robins across
   * currently-healthy endpoints; endpoints past their cooldown are given a
   * chance to re-prove themselves (actual recovery still happens via
   * `reportSuccess`/`reportFailure` on the outcome of that attempt).
   */
  selectEndpoint(): string {
    this.admitCooldownCandidates();

    const healthy = this.endpoints.filter((e) => e.healthy);
    // Fail open: if every endpoint is currently marked unhealthy, still try
    // the full configured list round-robin rather than refusing outright —
    // an outbound call will fail cleanly via its own error handling, and
    // the next success/failure report keeps endpoint health accurate.
    const pool = healthy.length > 0 ? healthy : this.endpoints;

    const endpoint = pool[this.cursor % pool.length];
    this.cursor = (this.cursor + 1) % pool.length;
    return endpoint.url;
  }

  /** Record a successful call against `url`; clears failures and rejoins it if it was unhealthy. */
  reportSuccess(url: string): void {
    const endpoint = this.endpoints.find((e) => e.url === url);
    if (!endpoint) return;

    endpoint.consecutiveFailures = 0;
    if (!endpoint.healthy) {
      endpoint.healthy = true;
      endpoint.markedUnhealthyAt = undefined;
      this.logger.log(`[HorizonFailover] "${url}" recovered — rejoining the healthy pool`);
    }
  }

  /** Record a failed call against `url`; marks it unhealthy after consecutive failures. */
  reportFailure(url: string): void {
    const endpoint = this.endpoints.find((e) => e.url === url);
    if (!endpoint) return;

    endpoint.consecutiveFailures += 1;
    if (endpoint.healthy && endpoint.consecutiveFailures >= this.unhealthyThreshold) {
      endpoint.healthy = false;
      endpoint.markedUnhealthyAt = new Date();
      this.logger.warn(
        `[HorizonFailover] "${url}" marked unhealthy after ${endpoint.consecutiveFailures} ` +
          `consecutive failures — avoiding it until it recovers`,
      );
    }
  }

  /** Current health snapshot of every configured endpoint, for health checks/metrics. */
  getStatus(): HorizonEndpointHealth[] {
    return this.endpoints.map((e) => ({ ...e }));
  }

  /** True once more than one Horizon endpoint is configured. */
  hasFailover(): boolean {
    return this.endpoints.length > 1;
  }

  /**
   * Lets endpoints that have been unhealthy past `cooldownMs` back into the
   * healthy pool so they get a chance to prove themselves on the next call.
   * If they're still down, the next `reportFailure` will simply re-exclude
   * them after resetting their cooldown clock.
   */
  private admitCooldownCandidates(): void {
    const now = Date.now();
    for (const endpoint of this.endpoints) {
      if (
        !endpoint.healthy &&
        endpoint.markedUnhealthyAt &&
        now - endpoint.markedUnhealthyAt.getTime() >= this.cooldownMs
      ) {
        endpoint.healthy = true;
        endpoint.consecutiveFailures = 0;
      }
    }
  }
}
