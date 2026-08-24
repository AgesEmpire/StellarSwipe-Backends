import { Injectable, Logger } from '@nestjs/common';
import {
  CircuitBreaker,
  CircuitOpenError,
} from '../common/circuit-breaker/circuit-breaker';

/**
 * Shared circuit breakers for Stellar provider operations (issue #1033).
 *
 * Separate breakers for read vs write so a flood of failed writes does not
 * block read-only market-data paths (and vice versa).
 */
@Injectable()
export class HorizonCircuitService {
  private readonly logger = new Logger(HorizonCircuitService.name);

  readonly reads = new CircuitBreaker({
    name: 'horizon-reads',
    failureThreshold: 8,
    successThreshold: 2,
    resetTimeoutMs: 20_000,
  });

  readonly writes = new CircuitBreaker({
    name: 'horizon-writes',
    failureThreshold: 5,
    successThreshold: 2,
    resetTimeoutMs: 30_000,
  });

  async executeRead<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.reads.exec(fn);
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        this.logger.warn('Horizon read circuit open — failing fast');
      }
      throw err;
    }
  }

  async executeWrite<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.writes.exec(fn);
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        this.logger.warn('Horizon write circuit open — failing fast');
      }
      throw err;
    }
  }

  getMetrics() {
    return {
      reads: this.reads.snapshot(),
      writes: this.writes.snapshot(),
    };
  }
}
