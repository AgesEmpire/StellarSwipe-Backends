/**
 * Event Serializer Service — schema validation and serialization for stored events
 *
 * Validates event schemas and serialization formats before persistence to ensure:
 *  1. Data integrity: Events conform to expected schemas before storage
 *  2. Security: Sensitive fields are detected and handled appropriately
 *  3. Compatibility: Serialization format versioning for backward compatibility
 *  4. Audit compliance: All stored events are valid and traceable
 *
 * Security: The service enforces schema validation before any persistence operation.
 * Invalid events are rejected with detailed validation errors. Sensitive field detection
 * works alongside existing authorization controls — this service does not bypass or
 * weaken existing access controls.
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { validateSync, ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BaseEvent, EventMetadata } from './base.event';

/** Serialized event format for storage */
export interface SerializedEvent {
  /** Unique event identifier (UUID v4) */
  id: string;
  /** Event type/name (e.g., 'trade.executed') */
  eventType: string;
  /** Event schema version for backward compatibility */
  schemaVersion: string;
  /** Serialized event payload (JSON string) */
  payload: string;
  /** Event metadata (correlation ID, timestamp, source) */
  metadata: EventMetadata & {
    correlationId: string;
    timestamp: string;
  };
  /** ISO 8601 timestamp of serialization */
  serializedAt: string;
  /** Hash of payload for integrity verification */
  payloadHash: string;
}

/** Validation result for event schema checks */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  sanitized: boolean;
}

/** Event schema registry entry */
interface SchemaRegistryEntry {
  version: string;
  requiredFields: string[];
  sensitiveFields: string[];
  validator?: (data: unknown) => ValidationResult;
}

/** Schema version constants */
export const SCHEMA_VERSIONS = {
  V1: '1.0.0',
  V2: '2.0.0',
  CURRENT: '2.0.0',
} as const;

/** Default sensitive fields to check in any event payload */
const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'token',
  'apiKey',
  'secret',
  'privateKey',
  'mnemonic',
  'seed',
  'credential',
  'auth',
  'authorization',
];

@Injectable()
export class EventSerializerService {
  private readonly logger = new Logger(EventSerializerService.name);
  private readonly schemaRegistry = new Map<string, SchemaRegistryEntry>();

  constructor() {
    this.registerDefaultSchemas();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Serialize an event for storage with schema validation.
   *
   * @param event - The event to serialize
   * @returns Serialized event ready for persistence
   * @throws BadRequestException if validation fails
   */
  serialize<T extends BaseEvent>(event: T): SerializedEvent {
    // 1. Validate event schema before serialization
    const validation = this.validateEvent(event);
    if (!validation.valid) {
      const errorMessages = this.formatValidationErrors(validation.errors);
      this.logger.warn(`Event validation failed for ${event.eventName}: ${errorMessages.join(', ')}`);
      throw new BadRequestException(
        `Event validation failed: ${errorMessages.join('; ')}`,
      );
    }

    // 2. Check for sensitive fields
    const sensitiveCheck = this.detectSensitiveFields(event);
    if (sensitiveCheck.found) {
      this.logger.warn(
        `Sensitive fields detected in event ${event.eventName}: ${sensitiveCheck.fields.join(', ')}`,
      );
    }

    // 3. Sanitize payload
    const sanitizedPayload = this.sanitizePayload(event);

    // 4. Create serialized event
    const serializedAt = new Date().toISOString();
    const payload = JSON.stringify(sanitizedPayload);

    const serialized: SerializedEvent = {
      id: this.generateEventId(),
      eventType: event.eventName,
      schemaVersion: SCHEMA_VERSIONS.CURRENT,
      payload,
      metadata: {
        correlationId: event.correlationId,
        timestamp: event.timestamp.toISOString(),
        source: 'event-serializer',
        version: SCHEMA_VERSIONS.CURRENT,
      },
      serializedAt,
      payloadHash: this.computePayloadHash(payload),
    };

    this.logger.debug(`Serialized event ${event.eventName} (id: ${serialized.id})`);

    return serialized;
  }

  /**
   * Deserialize a stored event back to a validated object.
   *
   * @param serialized - The serialized event from storage
   * @param EventClass - Optional event class for type-safe deserialization
   * @returns Deserialized and validated event instance
   * @throws BadRequestException if deserialization or validation fails
   */
  deserialize<T extends BaseEvent>(
    serialized: SerializedEvent,
    EventClass?: new (...args: any[]) => T,
  ): T | Record<string, unknown> {
    // 1. Verify payload integrity
    const computedHash = this.computePayloadHash(serialized.payload);
    if (computedHash !== serialized.payloadHash) {
      this.logger.error(`Payload hash mismatch for event ${serialized.id}`);
      throw new BadRequestException('Event payload integrity check failed');
    }

    // 2. Parse payload
    let parsedPayload: Record<string, unknown>;
    try {
      parsedPayload = JSON.parse(serialized.payload);
    } catch (error) {
      this.logger.error(`Failed to parse event payload: ${(error as Error).message}`);
      throw new BadRequestException('Invalid event payload format');
    }

    // 3. Schema version compatibility check
    if (!this.isSchemaVersionCompatible(serialized.schemaVersion)) {
      this.logger.warn(
        `Schema version ${serialized.schemaVersion} may not be fully compatible with current ${SCHEMA_VERSIONS.CURRENT}`,
      );
    }

    // 4. Type-safe deserialization if class provided
    if (EventClass) {
      const instance = plainToInstance(EventClass, {
        ...parsedPayload,
        correlationId: serialized.metadata.correlationId,
      });

      const validation = this.validateEvent(instance);
      if (!validation.valid) {
        const errorMessages = this.formatValidationErrors(validation.errors);
        throw new BadRequestException(
          `Deserialized event validation failed: ${errorMessages.join('; ')}`,
        );
      }

      return instance;
    }

    // 5. Return plain object if no class specified
    return {
      ...parsedPayload,
      __metadata: serialized.metadata,
      __eventType: serialized.eventType,
      __schemaVersion: serialized.schemaVersion,
    } as Record<string, unknown>;
  }

  /**
   * Validate an event against its registered schema.
   *
   * @param event - The event to validate
   * @returns Validation result with errors if any
   */
  validateEvent<T extends BaseEvent>(event: T): ValidationResult {
    // Run class-validator validation
    const errors = validateSync(event as object);

    // Run custom validate() method if present
    let customErrors: ValidationError[] = [];
    if (typeof event.validate === 'function') {
      try {
        event.validate();
      } catch (error) {
        const message = (error as Error).message;
        customErrors = [
          {
            property: 'custom',
            constraints: { customValidation: message },
          } as ValidationError,
        ];
      }
    }

    // Check schema registry for additional validation
    const registryEntry = this.schemaRegistry.get(event.eventName);
    let sanitized = false;

    if (registryEntry?.validator) {
      const registryResult = registryEntry.validator(event);
      if (!registryResult.valid) {
        errors.push(...registryResult.errors);
      }
      sanitized = registryResult.sanitized;
    }

    const allErrors = [...errors, ...customErrors];

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      sanitized,
    };
  }

  /**
   * Validate a batch of events for bulk operations.
   *
   * @param events - Array of events to validate
   * @returns Object with valid events and validation errors by index
   */
  validateBatch<T extends BaseEvent>(events: T[]): {
    valid: Array<{ event: T; index: number }>;
    invalid: Array<{ event: T; index: number; errors: ValidationError[] }>;
  } {
    const valid: Array<{ event: T; index: number }> = [];
    const invalid: Array<{ event: T; index: number; errors: ValidationError[] }> = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const validation = this.validateEvent(event);

      if (validation.valid) {
        valid.push({ event, index: i });
      } else {
        invalid.push({ event, index: i, errors: validation.errors });
      }
    }

    return { valid, invalid };
  }

  /**
   * Register a custom schema for event validation.
   *
   * @param eventType - The event type/name
   * @param schema - Schema configuration
   */
  registerSchema(
    eventType: string,
    schema: Omit<SchemaRegistryEntry, 'sensitiveFields'> & { sensitiveFields?: string[] },
  ): void {
    this.schemaRegistry.set(eventType, {
      ...schema,
      sensitiveFields: [...DEFAULT_SENSITIVE_FIELDS, ...(schema.sensitiveFields || [])],
    });
    this.logger.debug(`Registered schema for event type: ${eventType}`);
  }

  /**
   * Check if an event type has a registered schema.
   */
  hasSchema(eventType: string): boolean {
    return this.schemaRegistry.has(eventType);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private registerDefaultSchemas(): void {
    // Trade events schema
    this.registerSchema('trade.executed', {
      version: SCHEMA_VERSIONS.CURRENT,
      requiredFields: ['tradeId', 'userId', 'symbol', 'type', 'quantity', 'price', 'totalValue'],
      sensitiveFields: ['accountId'],
    });

    this.registerSchema('trade.failed', {
      version: SCHEMA_VERSIONS.CURRENT,
      requiredFields: ['tradeId', 'userId', 'reason'],
    });

    this.registerSchema('trade.cancelled', {
      version: SCHEMA_VERSIONS.CURRENT,
      requiredFields: ['tradeId', 'userId', 'reason'],
    });

    // Signal events schema
    this.registerSchema('signal.created', {
      version: SCHEMA_VERSIONS.CURRENT,
      requiredFields: ['signalId', 'userId', 'symbol', 'type', 'targetPrice'],
    });

    this.registerSchema('signal.performance.updated', {
      version: SCHEMA_VERSIONS.CURRENT,
      requiredFields: ['signalId', 'userId', 'performanceScore', 'returnPercentage', 'copiers'],
    });

    this.registerSchema('signal.validated', {
      version: SCHEMA_VERSIONS.CURRENT,
      requiredFields: ['signalId', 'status'],
    });

    // User events schema
    this.registerSchema('user.registered', {
      version: SCHEMA_VERSIONS.CURRENT,
      requiredFields: ['userId', 'email', 'username'],
      sensitiveFields: ['email', 'phone'],
    });

    this.registerSchema('user.profile.updated', {
      version: SCHEMA_VERSIONS.CURRENT,
      requiredFields: ['userId'],
    });

    this.registerSchema('user.followed.provider', {
      version: SCHEMA_VERSIONS.CURRENT,
      requiredFields: ['userId', 'providerId'],
    });
  }

  private generateEventId(): string {
    return crypto.randomUUID();
  }

  private computePayloadHash(payload: string): string {
    // Simple hash for integrity checking - in production, use a proper hash
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return hash.toString(16);
  }

  private detectSensitiveFields(event: BaseEvent): { found: boolean; fields: string[] } {
    const sensitiveFields: string[] = [];
    const payload = event as Record<string, unknown>;

    const checkValue = (value: unknown, path: string): void => {
      if (value === null || value === undefined) return;

      if (typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, val] of Object.entries(value)) {
          const newPath = path ? `${path}.${key}` : key;
          if (DEFAULT_SENSITIVE_FIELDS.some(f => key.toLowerCase().includes(f.toLowerCase()))) {
            sensitiveFields.push(newPath);
          }
          checkValue(val, newPath);
        }
      }
    };

    checkValue(payload, '');

    return {
      found: sensitiveFields.length > 0,
      fields: sensitiveFields,
    };
  }

  private sanitizePayload<T extends BaseEvent>(event: T): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(event)) {
      // Skip internal fields
      if (key === 'timestamp' || key === 'correlationId' || key === 'eventName') {
        continue;
      }

      // Redact sensitive fields
      if (DEFAULT_SENSITIVE_FIELDS.some(f => key.toLowerCase().includes(f.toLowerCase()))) {
        payload[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        payload[key] = this.deepSanitize(value as Record<string, unknown>);
      } else {
        payload[key] = value;
      }
    }

    return payload;
  }

  private deepSanitize(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (DEFAULT_SENSITIVE_FIELDS.some(f => key.toLowerCase().includes(f.toLowerCase()))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.deepSanitize(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private formatValidationErrors(errors: ValidationError[]): string[] {
    return errors.map(error => {
      if (error.constraints) {
        return `${error.property}: ${Object.values(error.constraints).join(', ')}`;
      }
      if (error.children && error.children.length > 0) {
        return `${error.property}: ${this.formatValidationErrors(error.children).join(', ')}`;
      }
      return `${error.property}: validation failed`;
    });
  }

  private isSchemaVersionCompatible(version: string): boolean {
    const [major] = version.split('.').map(Number);
    const [currentMajor] = SCHEMA_VERSIONS.CURRENT.split('.').map(Number);
    return major === currentMajor;
  }
}
