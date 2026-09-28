import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SOROBAN_CIRCUIT_OPENED_EVENT } from '../soroban/soroban-rpc-resilience.service';

/**
 * Reacts to the Soroban RPC circuit breaker tripping (issue #852's
 * `SorobanCircuitOpened`). Currently just logs; wire alerting here.
 */
@Injectable()
export class SorobanCircuitListener {
  private readonly logger = new Logger(SorobanCircuitListener.name);

  @OnEvent(SOROBAN_CIRCUIT_OPENED_EVENT)
  handleSorobanCircuitOpened(payload: { circuit: string; timestamp: Date }) {
    this.logger.warn(
      `Soroban RPC circuit "${payload.circuit}" opened at ${payload.timestamp.toISOString()} — requests are failing fast until it recovers.`,
    );

    // TODO: page on-call / notify #incidents once an alerting channel is wired up.
  }
}
