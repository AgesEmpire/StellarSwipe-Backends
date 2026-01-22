import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { StellarConfigService } from '../../config/stellar.service';
import * as StellarSdk from '@stellar/stellar-sdk';

@Injectable()
export class StellarHealthIndicator extends HealthIndicator {
  private server: StellarSdk.Horizon.Server;

  constructor(private stellarConfig: StellarConfigService) {
    super();
    this.server = new StellarSdk.Horizon.Server(this.stellarConfig.horizonUrl);
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      const ledger = await this.server.ledgers().order('desc').limit(1).call();

      const latency = Date.now() - startTime;
      const latestLedger = ledger.records[0];

      const result = this.getStatus(key, true, {
        network: this.stellarConfig.network,
        horizonUrl: this.stellarConfig.horizonUrl,
        latestLedger: latestLedger?.sequence,
        latency: `${latency}ms`,
      });

      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      throw new HealthCheckError(
        'Stellar Horizon check failed',
        this.getStatus(key, false, {
          network: this.stellarConfig.network,
          horizonUrl: this.stellarConfig.horizonUrl,
          error: errorMessage,
          latency: `${latency}ms`,
        }),
      );
    }
  }
}
