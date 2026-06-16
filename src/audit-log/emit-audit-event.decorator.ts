import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditEventType, AuditEventPayload } from './audit.events';

/**
 * Decorator to automatically emit audit events on method completion
 * @param eventType The audit event type to emit
 * @param includeArgs Whether to include method arguments in metadata
 */
export function EmitAuditEvent(eventType: AuditEventType, includeArgs = false) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      let result: any;
      let error: Error | null = null;

      try {
        result = await originalMethod.apply(this, args);
        return result;
      } catch (err) {
        error = err as Error;
        throw err;
      } finally {
        // Get EventEmitter from the service instance
        const eventEmitter: EventEmitter2 = this.eventEmitter;
        if (!eventEmitter) {
          console.warn(
            `EventEmitter not available in ${target.constructor.name}`,
          );
          return;
        }

        const payload: AuditEventPayload = {
          userId: args[0]?.userId || args[0],
          action: eventType,
          metadata: includeArgs ? { args } : undefined,
          status: error ? 'FAILURE' : 'SUCCESS',
          errorMessage: error?.message,
        };

        eventEmitter.emit(eventType, payload);
      }
    };

    return descriptor;
  };
}
