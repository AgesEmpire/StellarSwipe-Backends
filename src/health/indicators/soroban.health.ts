import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { StellarConfigService } from '../../config/stellar.service';
import * as StellarSdk from '@stellar/stellar-sdk';
import { CircuitBreakerService } from '../../http/circuit-breaker.service';
import { SOROBAN_RPC_CIRCUIT } from '../../soroban/soroban-rpc-resilience.service';

@Injectable()
export class SorobanHealthIndicator extends HealthIndicator {
  constructor(
    private stellarConfig: StellarConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();
    const circuitBreakerState =
      this.circuitBreaker.getState(SOROBAN_RPC_CIRCUIT);

    try {
      const server = new StellarSdk.SorobanRpc.Server(
        this.stellarConfig.sorobanRpcUrl,
      );

      const health = await this.withTimeout(server.getHealth(), 5000);

      const latency = Date.now() - startTime;

      const result = this.getStatus(key, true, {
        network: this.stellarConfig.network,
        sorobanRpcUrl: this.stellarConfig.sorobanRpcUrl,
        status: health.status,
        latency: `${latency}ms`,
        circuitBreakerState,
      });

      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      throw new HealthCheckError(
        'Soroban RPC check failed',
        this.getStatus(key, false, {
          network: this.stellarConfig.network,
          sorobanRpcUrl: this.stellarConfig.sorobanRpcUrl,
          error: errorMessage,
          latency: `${latency}ms`,
          circuitBreakerState,
        }),
      );
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(`Soroban RPC health check timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
