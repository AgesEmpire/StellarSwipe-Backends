import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RotationEventPayload } from './rotation.types';

/** Event name used for all rotation lifecycle events. */
export const ROTATION_LIFECYCLE_EVENT = 'secret.rotation.lifecycle';

/**
 * RotationEventService — emits structured events for each phase of a
 * credential rotation so that downstream consumers (DB pool, JWT guard,
 * cache layer, etc.) can react appropriately.
 *
 * Phases:
 *   started         → rotation has been initiated
 *   overlap-active  → old credential is still accepted alongside the new one
 *   overlap-expired → old credential is no longer accepted
 *   completed       → rotation finished successfully
 *   failed          → rotation encountered an error
 */
@Injectable()
export class RotationEventService {
  private readonly logger = new Logger(RotationEventService.name);

  constructor(private readonly events: EventEmitter2) {}

  emitStarted(secretName: string, detail?: string): void {
    this.emit({ secretName, phase: 'started', detail });
  }

  emitOverlapActive(secretName: string, detail?: string): void {
    this.emit({ secretName, phase: 'overlap-active', detail });
  }

  emitOverlapExpired(secretName: string, detail?: string): void {
    this.emit({ secretName, phase: 'overlap-expired', detail });
  }

  emitCompleted(secretName: string, detail?: string): void {
    this.emit({ secretName, phase: 'completed', detail });
  }

  emitFailed(secretName: string, detail?: string): void {
    this.emit({ secretName, phase: 'failed', detail });
  }

  private emit(partial: Omit<RotationEventPayload, 'timestamp'>): void {
    const payload: RotationEventPayload = {
      ...partial,
      timestamp: new Date().toISOString(),
    };

    this.logger.log(`Rotation [${payload.phase}] for "${payload.secretName}"`);
    this.events.emit(ROTATION_LIFECYCLE_EVENT, payload);
  }
}
