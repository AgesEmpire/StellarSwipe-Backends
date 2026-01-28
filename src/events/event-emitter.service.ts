import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BaseEvent } from './events/base.event';

@Injectable()
export class EventEmitterService {
  private readonly logger = new Logger(EventEmitterService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Emit a type-safe event with automatic logging and error handling
   */
  async emit<T extends BaseEvent>(event: T): Promise<boolean> {
    try {
      this.logger.log(`Emitting event: ${event.eventName}`, {
        eventName: event.eventName,
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        payload: this.sanitizePayload(event),
      });

      const result = this.eventEmitter.emit(event.eventName, event);
      
      this.logger.debug(`Event emitted successfully: ${event.eventName}`, {
        listenerCount: this.eventEmitter.listenerCount(event.eventName),
      });

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to emit event: ${event.eventName}`,
        error.stack,
        {
          eventName: event.eventName,
          error: error.message,
          correlationId: event.correlationId,
        },
      );
      throw error;
    }
  }

  /**
   * Emit event asynchronously without waiting for listeners
   */
  emitAsync<T extends BaseEvent>(event: T): void {
    setImmediate(() => {
      this.emit(event).catch((error) => {
        this.logger.error(
          `Async event emission failed: ${event.eventName}`,
          error.stack,
        );
      });
    });
  }

  /**
   * Get the number of listeners for a specific event
   */
  getListenerCount(eventName: string): number {
    return this.eventEmitter.listenerCount(eventName);
  }

  /**
   * Remove sensitive data from logs
   */
  private sanitizePayload(event: BaseEvent): any {
    const payload = { ...event };
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret'];
    
    Object.keys(payload).forEach((key) => {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        payload[key] = '[REDACTED]';
      }
    });

    return payload;
  }
}