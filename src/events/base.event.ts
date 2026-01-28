import { v4 as uuidv4 } from 'uuid';

export abstract class BaseEvent {
  readonly timestamp: Date;
  readonly correlationId: string;
  abstract readonly eventName: string;

  constructor(correlationId?: string) {
    this.timestamp = new Date();
    this.correlationId = correlationId || uuidv4();
  }

  /**
   * Validate event payload before emission
   */
  abstract validate(): void;
}

/**
 * Event metadata for tracking and debugging
 */
export interface EventMetadata {
  userId?: string;
  traceId?: string;
  source?: string;
  version?: string;
}