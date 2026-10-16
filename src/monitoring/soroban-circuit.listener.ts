import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { CircuitState } from '../http/circuit-breaker.service';
import {
  SOROBAN_CIRCUIT_HALF_OPEN_EVENT,
  SOROBAN_CIRCUIT_OPENED_EVENT,
  SOROBAN_CIRCUIT_RECOVERED_EVENT,
  SorobanCircuitTransition,
} from '../soroban/soroban-rpc-resilience.service';

/**
 * Operational alerting channel consumed by `AlertNotificationService`
 * (webhook + Slack + structured logs). Reusing the existing Soroban alert
 * event keeps circuit transitions on the same channel on-call staff watch.
 */
export const OPERATIONAL_ALERT_EVENT = 'alert.soroban.failure';

interface ActiveCircuitAlert {
  alertId: string;
  openedAt: Date;
  network: string;
  service: string;
  /** Whether the half-open probe has already been surfaced for this episode. */
  halfOpenNotified: boolean;
}

interface CircuitAlert {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  alertId: string;
  resolvedAlertId?: string;
  message: string;
  transition: SorobanCircuitTransition;
}

/**
 * Reacts to Soroban RPC circuit breaker transitions (issue #852's
 * `SorobanCircuitOpened` and the half-open / recovered transitions) and pages
 * operators through the shared alerting channel.
 *
 * Guarantees:
 *  - Every transition carries network + service context.
 *  - Transitions are deduplicated: an episode pages once on open, once on
 *    half-open, and recovery resolves (closes) the corresponding alert.
 *  - A failing alerting channel never propagates out of the event handler.
 */
@Injectable()
export class SorobanCircuitListener {
  private readonly logger = new Logger(SorobanCircuitListener.name);
  /** Open alerts keyed by circuit name, so recovery can resolve them. */
  private readonly activeAlerts = new Map<string, ActiveCircuitAlert>();
  /** Last state reacted to per circuit — guards against replayed events. */
  private readonly lastState = new Map<string, CircuitState>();

  constructor(private readonly eventEmitter: EventEmitter2) {}

  @OnEvent(SOROBAN_CIRCUIT_OPENED_EVENT)
  handleSorobanCircuitOpened(payload: SorobanCircuitTransition): void {
    this.handleTransition(payload);
  }

  @OnEvent(SOROBAN_CIRCUIT_HALF_OPEN_EVENT)
  handleSorobanCircuitHalfOpen(payload: SorobanCircuitTransition): void {
    this.handleTransition(payload);
  }

  @OnEvent(SOROBAN_CIRCUIT_RECOVERED_EVENT)
  handleSorobanCircuitRecovered(payload: SorobanCircuitTransition): void {
    this.handleTransition(payload);
  }

  /** Snapshot of the currently open circuit alerts (observability / tests). */
  getActiveAlerts(): Record<string, ActiveCircuitAlert> {
    const snapshot: Record<string, ActiveCircuitAlert> = {};
    this.activeAlerts.forEach((alert, circuit) => {
      snapshot[circuit] = { ...alert };
    });
    return snapshot;
  }

  private handleTransition(transition: SorobanCircuitTransition): void {
    const circuit = transition?.circuit ?? 'soroban-rpc';

    // Deduplicate: ignore a state we have already reacted to. The resilience
    // service only emits on real changes, but replayed/duplicate deliveries
    // must never page on-call twice.
    if (this.lastState.get(circuit) === transition?.state) {
      this.logger.debug(
        `Ignoring duplicate Soroban circuit "${circuit}" transition to ${transition?.state}`,
      );
      return;
    }
    this.lastState.set(circuit, transition?.state);

    switch (transition?.state) {
      case CircuitState.OPEN:
        this.handleOpened(transition);
        break;
      case CircuitState.HALF_OPEN:
        this.handleHalfOpen(transition);
        break;
      case CircuitState.CLOSED:
        this.handleRecovered(transition);
        break;
      default:
        break;
    }
  }

  private handleOpened(transition: SorobanCircuitTransition): void {
    const circuit = transition.circuit;
    const existing = this.activeAlerts.get(circuit);
    if (existing) {
      this.logger.warn(
        `Soroban RPC circuit "${circuit}" re-opened while alert ${existing.alertId} is still active — suppressing duplicate page.`,
      );
      return;
    }

    const alert: ActiveCircuitAlert = {
      alertId: randomUUID(),
      openedAt: transition.timestamp ?? new Date(),
      network: this.networkOf(transition),
      service: this.serviceOf(transition),
      halfOpenNotified: false,
    };
    this.activeAlerts.set(circuit, alert);

    this.logger.warn(
      `Soroban RPC circuit "${circuit}" opened on ${alert.network} at ${alert.openedAt.toISOString()} — requests to ${alert.service} are failing fast until it recovers.`,
    );

    this.dispatch({
      type: 'soroban_circuit_open',
      severity: 'critical',
      alertId: alert.alertId,
      transition,
      message:
        `Soroban RPC circuit "${circuit}" opened on ${alert.network}. ` +
        `Requests to ${alert.service} (${transition.operation}) are failing fast and will be rejected until recovery.`,
    });
  }

  private handleHalfOpen(transition: SorobanCircuitTransition): void {
    const circuit = transition.circuit;
    const alert =
      this.activeAlerts.get(circuit) ??
      ({
        alertId: randomUUID(),
        openedAt: transition.timestamp ?? new Date(),
        network: this.networkOf(transition),
        service: this.serviceOf(transition),
        halfOpenNotified: false,
      } as ActiveCircuitAlert);

    if (alert.halfOpenNotified) {
      this.logger.debug(
        `Soroban RPC circuit "${circuit}" half-open probe already alerted`,
      );
      return;
    }

    alert.halfOpenNotified = true;
    this.activeAlerts.set(circuit, alert);

    this.logger.log(
      `Soroban RPC circuit "${circuit}" probing recovery (HALF_OPEN) on ${alert.network}`,
    );

    this.dispatch({
      type: 'soroban_circuit_half_open',
      severity: 'high',
      alertId: alert.alertId,
      transition,
      message:
        `Soroban RPC circuit "${circuit}" is HALF_OPEN on ${alert.network}. ` +
        `A probe request to ${alert.service} is being allowed to test recovery.`,
    });
  }

  private handleRecovered(transition: SorobanCircuitTransition): void {
    const circuit = transition.circuit;
    const alert = this.activeAlerts.get(circuit);
    this.activeAlerts.delete(circuit);

    const network = alert?.network ?? this.networkOf(transition);
    const service = alert?.service ?? this.serviceOf(transition);

    this.logger.log(
      `Soroban RPC circuit "${circuit}" recovered (CLOSED) on ${network}${alert ? ` — resolving alert ${alert.alertId}` : ''}`,
    );

    this.dispatch({
      type: 'soroban_circuit_recovered',
      severity: 'low',
      alertId: alert?.alertId ?? randomUUID(),
      resolvedAlertId: alert?.alertId,
      transition,
      message: alert
        ? `Soroban RPC circuit "${circuit}" recovered on ${network}. Alert ${alert.alertId} for ${service} is resolved.`
        : `Soroban RPC circuit "${circuit}" recovered on ${network}. ${service} is serving requests normally again.`,
    });
  }

  /**
   * Publish a structured alert on the operational channel. Failures here are
   * swallowed (and logged) so an alerting outage can never break the event
   * handler that observed the transition.
   */
  private dispatch(alert: CircuitAlert): void {
    const { transition } = alert;
    try {
      this.eventEmitter.emit(OPERATIONAL_ALERT_EVENT, {
        type: alert.type,
        severity: alert.severity,
        timestamp: transition.timestamp ?? new Date(),
        message: alert.message,
        metrics: {
          alertId: alert.alertId,
          resolvedAlertId: alert.resolvedAlertId,
          circuit: transition.circuit,
          service: this.serviceOf(transition),
          network: this.networkOf(transition),
          state: transition.state,
          previousState: transition.previousState,
          operation: transition.operation,
          // Retained for the existing ops-channel formatters.
          failureCount: 0,
          affectedEndpoints: [this.serviceOf(transition)],
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to dispatch Soroban circuit alert for "${transition?.circuit}": ${message}`,
      );
    }
  }

  private networkOf(transition: SorobanCircuitTransition): string {
    return transition?.network ?? 'unknown';
  }

  private serviceOf(transition: SorobanCircuitTransition): string {
    return transition?.service ?? transition?.circuit ?? 'soroban-rpc';
  }
}
