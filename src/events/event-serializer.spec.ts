import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  EventSerializerService,
  SerializedEvent,
  SCHEMA_VERSIONS,
  ValidationResult,
} from './event-serializer';
import {
  TradeExecutedEvent,
  TradeFailedEvent,
  TradeCancelledEvent,
  TradeType,
} from './trade.events';
import {
  SignalCreatedEvent,
  SignalPerformanceUpdatedEvent,
  SignalValidatedEvent,
  SignalType,
  SignalStatus,
} from './signal.events';
import {
  UserRegisteredEvent,
  UserProfileUpdatedEvent,
  UserFollowedProviderEvent,
} from './user.events';

describe('EventSerializerService', () => {
  let service: EventSerializerService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [EventSerializerService],
    }).compile();

    service = module.get(EventSerializerService);
  });

  describe('serialize()', () => {
    it('serializes a valid TradeExecutedEvent', () => {
      const event = new TradeExecutedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: TradeType.BUY,
        quantity: 100,
        price: 0.5,
        totalValue: 50,
      });

      const serialized = service.serialize(event);

      expect(serialized.id).toBeDefined();
      expect(serialized.eventType).toBe('trade.executed');
      expect(serialized.schemaVersion).toBe(SCHEMA_VERSIONS.CURRENT);
      expect(serialized.payload).toBeDefined();
      expect(serialized.payloadHash).toBeDefined();
      expect(serialized.metadata.correlationId).toBe(event.correlationId);
      expect(serialized.metadata.timestamp).toBe(event.timestamp.toISOString());
    });

    it('throws BadRequestException for invalid event', () => {
      const event = new TradeExecutedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: TradeType.BUY,
        quantity: -100, // Invalid: negative quantity
        price: 0.5,
        totalValue: 50,
      });

      expect(() => service.serialize(event)).toThrow(BadRequestException);
    });

    it('serializes a valid SignalCreatedEvent', () => {
      const event = new SignalCreatedEvent({
        signalId: 'signal-789',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: SignalType.BUY,
        targetPrice: 0.6,
      });

      const serialized = service.serialize(event);

      expect(serialized.eventType).toBe('signal.created');
      expect(serialized.schemaVersion).toBe(SCHEMA_VERSIONS.CURRENT);
      expect(JSON.parse(serialized.payload).signalId).toBe('signal-789');
    });

    it('redacts sensitive fields during serialization', () => {
      const event = new UserRegisteredEvent({
        userId: 'user-789',
        email: 'test@example.com',
        username: 'testuser',
      });

      const serialized = service.serialize(event);
      const payload = JSON.parse(serialized.payload);

      // Email is marked as sensitive in schema
      expect(payload.email).toBe('[REDACTED]');
    });

    it('includes all required metadata fields', () => {
      const event = new TradeExecutedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: TradeType.BUY,
        quantity: 100,
        price: 0.5,
        totalValue: 50,
      });

      const serialized = service.serialize(event);

      expect(serialized.metadata).toHaveProperty('correlationId');
      expect(serialized.metadata).toHaveProperty('timestamp');
      expect(serialized.metadata).toHaveProperty('source');
      expect(serialized.metadata).toHaveProperty('version');
      expect(serialized.metadata.source).toBe('event-serializer');
    });

    it('generates unique IDs for each serialization', () => {
      const event = new TradeExecutedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: TradeType.BUY,
        quantity: 100,
        price: 0.5,
        totalValue: 50,
      });

      const serialized1 = service.serialize(event);
      const serialized2 = service.serialize(event);

      expect(serialized1.id).not.toBe(serialized2.id);
    });
  });

  describe('deserialize()', () => {
    it('deserializes a TradeExecutedEvent with type-safe validation', () => {
      const originalEvent = new TradeExecutedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: TradeType.BUY,
        quantity: 100,
        price: 0.5,
        totalValue: 50,
      });

      const serialized = service.serialize(originalEvent);
      const deserialized = service.deserialize(serialized, TradeExecutedEvent);

      expect(deserialized).toBeInstanceOf(TradeExecutedEvent);
      expect(deserialized.tradeId).toBe('trade-123');
      expect(deserialized.userId).toBe('user-456');
      expect(deserialized.type).toBe(TradeType.BUY);
    });

    it('deserializes without EventClass returns plain object', () => {
      const originalEvent = new SignalCreatedEvent({
        signalId: 'signal-789',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: SignalType.BUY,
        targetPrice: 0.6,
      });

      const serialized = service.serialize(originalEvent);
      const deserialized = service.deserialize(serialized);

      expect(deserialized).not.toBeInstanceOf(SignalCreatedEvent);
      expect(deserialized.signalId).toBe('signal-789');
      expect(deserialized.__eventType).toBe('signal.created');
    });

    it('throws BadRequestException on hash mismatch', () => {
      const originalEvent = new TradeExecutedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: TradeType.BUY,
        quantity: 100,
        price: 0.5,
        totalValue: 50,
      });

      const serialized = service.serialize(originalEvent);
      // Tamper with the payload
      serialized.payload = JSON.stringify({ ...JSON.parse(serialized.payload), tampered: true });

      expect(() => service.deserialize(serialized, TradeExecutedEvent)).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException on invalid JSON payload', () => {
      const serialized: SerializedEvent = {
        id: 'test-id',
        eventType: 'trade.executed',
        schemaVersion: SCHEMA_VERSIONS.CURRENT,
        payload: 'invalid json {{',
        metadata: {
          correlationId: 'corr-123',
          timestamp: new Date().toISOString(),
        },
        serializedAt: new Date().toISOString(),
        payloadHash: '0', // Hash won't match, but JSON parse will fail first
      };

      expect(() => service.deserialize(serialized)).toThrow(BadRequestException);
    });

    it('includes metadata in deserialized plain object', () => {
      const originalEvent = new TradeExecutedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: TradeType.BUY,
        quantity: 100,
        price: 0.5,
        totalValue: 50,
      });

      const serialized = service.serialize(originalEvent);
      const deserialized = service.deserialize(serialized) as Record<string, unknown>;

      expect(deserialized.__metadata).toBeDefined();
      expect(deserialized.__eventType).toBe('trade.executed');
      expect(deserialized.__schemaVersion).toBe(SCHEMA_VERSIONS.CURRENT);
    });
  });

  describe('validateEvent()', () => {
    it('returns valid=true for valid TradeExecutedEvent', () => {
      const event = new TradeExecutedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: TradeType.BUY,
        quantity: 100,
        price: 0.5,
        totalValue: 50,
      });

      const result = service.validateEvent(event);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns valid=false with errors for invalid event', () => {
      const event = new TradeExecutedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: TradeType.BUY,
        quantity: -100, // Invalid
        price: 0.5,
        totalValue: 50,
      });

      const result = service.validateEvent(event);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('validates SignalPerformanceUpdatedEvent with constraints', () => {
      const event = new SignalPerformanceUpdatedEvent({
        signalId: 'signal-123',
        userId: 'user-456',
        performanceScore: 85,
        returnPercentage: 10.5,
        copiers: 25,
      });

      const result = service.validateEvent(event);
      expect(result.valid).toBe(true);
    });

    it('validates UserRegisteredEvent with email format', () => {
      const event = new UserRegisteredEvent({
        userId: 'user-789',
        email: 'invalid-email', // Invalid email format
        username: 'testuser',
      });

      const result = service.validateEvent(event);
      expect(result.valid).toBe(false);
    });
  });

  describe('validateBatch()', () => {
    it('separates valid and invalid events', () => {
      const validEvent = new TradeExecutedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: TradeType.BUY,
        quantity: 100,
        price: 0.5,
        totalValue: 50,
      });

      const invalidEvent = new TradeExecutedEvent({
        tradeId: 'trade-456',
        userId: 'user-789',
        symbol: 'BTC/USD',
        type: TradeType.SELL,
        quantity: -50, // Invalid
        price: 50000,
        totalValue: 2500000,
      });

      const result = service.validateBatch([validEvent, invalidEvent]);

      expect(result.valid).toHaveLength(1);
      expect(result.valid[0].index).toBe(0);
      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0].index).toBe(1);
      expect(result.invalid[0].errors.length).toBeGreaterThan(0);
    });

    it('handles empty batch', () => {
      const result = service.validateBatch([]);

      expect(result.valid).toHaveLength(0);
      expect(result.invalid).toHaveLength(0);
    });

    it('handles all valid events', () => {
      const events = [
        new TradeExecutedEvent({
          tradeId: 'trade-1',
          userId: 'user-1',
          symbol: 'XLM/USDC',
          type: TradeType.BUY,
          quantity: 100,
          price: 0.5,
          totalValue: 50,
        }),
        new TradeExecutedEvent({
          tradeId: 'trade-2',
          userId: 'user-2',
          symbol: 'BTC/USD',
          type: TradeType.SELL,
          quantity: 1,
          price: 50000,
          totalValue: 50000,
        }),
      ];

      const result = service.validateBatch(events);

      expect(result.valid).toHaveLength(2);
      expect(result.invalid).toHaveLength(0);
    });
  });

  describe('schema registry', () => {
    it('has default schemas registered', () => {
      expect(service.hasSchema('trade.executed')).toBe(true);
      expect(service.hasSchema('trade.failed')).toBe(true);
      expect(service.hasSchema('trade.cancelled')).toBe(true);
      expect(service.hasSchema('signal.created')).toBe(true);
      expect(service.hasSchema('signal.performance.updated')).toBe(true);
      expect(service.hasSchema('signal.validated')).toBe(true);
      expect(service.hasSchema('user.registered')).toBe(true);
      expect(service.hasSchema('user.profile.updated')).toBe(true);
      expect(service.hasSchema('user.followed.provider')).toBe(true);
    });

    it('can register custom schema', () => {
      service.registerSchema('custom.event', {
        version: '1.0.0',
        requiredFields: ['customId', 'customData'],
        sensitiveFields: ['secret'],
      });

      expect(service.hasSchema('custom.event')).toBe(true);
    });

    it('returns false for unregistered schema', () => {
      expect(service.hasSchema('nonexistent.event')).toBe(false);
    });
  });

  describe('sensitive field detection', () => {
    it('detects sensitive fields in nested objects', () => {
      const event = new UserRegisteredEvent({
        userId: 'user-789',
        email: 'test@example.com',
        username: 'testuser',
        metadata: {
          source: 'web',
          apiKey: 'secret-key-123', // Sensitive field
        },
      });

      const serialized = service.serialize(event);
      const payload = JSON.parse(serialized.payload);

      expect(payload.metadata.apiKey).toBe('[REDACTED]');
    });

    it('redacts password fields', () => {
      const event = new UserRegisteredEvent({
        userId: 'user-789',
        email: 'test@example.com',
        username: 'testuser',
        metadata: {
          source: 'web',
          password: 'secret123', // Should be redacted
        },
      });

      const serialized = service.serialize(event);
      const payload = JSON.parse(serialized.payload);

      expect(payload.metadata.password).toBe('[REDACTED]');
    });

    it('redacts token fields', () => {
      const event = new UserRegisteredEvent({
        userId: 'user-789',
        email: 'test@example.com',
        username: 'testuser',
        metadata: {
          source: 'web',
          authToken: 'bearer-token-123', // Should be redacted
        },
      });

      const serialized = service.serialize(event);
      const payload = JSON.parse(serialized.payload);

      expect(payload.metadata.authToken).toBe('[REDACTED]');
    });
  });

  describe('round-trip serialization', () => {
    it('correctly round-trips TradeExecutedEvent', () => {
      const original = new TradeExecutedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: TradeType.BUY,
        quantity: 100,
        price: 0.5,
        totalValue: 50,
        signalId: 'signal-789',
      });

      const serialized = service.serialize(original);
      const deserialized = service.deserialize(serialized, TradeExecutedEvent);

      expect(deserialized.tradeId).toBe(original.tradeId);
      expect(deserialized.userId).toBe(original.userId);
      expect(deserialized.symbol).toBe(original.symbol);
      expect(deserialized.type).toBe(original.type);
      expect(deserialized.quantity).toBe(original.quantity);
      expect(deserialized.price).toBe(original.price);
      expect(deserialized.totalValue).toBe(original.totalValue);
      expect(deserialized.signalId).toBe(original.signalId);
      expect(deserialized.correlationId).toBe(original.correlationId);
    });

    it('correctly round-trips SignalCreatedEvent', () => {
      const original = new SignalCreatedEvent({
        signalId: 'signal-789',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: SignalType.BUY,
        targetPrice: 0.6,
        stopLoss: 0.4,
        takeProfit: 0.8,
        reasoning: 'Bullish momentum',
      });

      const serialized = service.serialize(original);
      const deserialized = service.deserialize(serialized, SignalCreatedEvent);

      expect(deserialized.signalId).toBe(original.signalId);
      expect(deserialized.symbol).toBe(original.symbol);
      expect(deserialized.type).toBe(original.type);
      expect(deserialized.targetPrice).toBe(original.targetPrice);
      expect(deserialized.stopLoss).toBe(original.stopLoss);
      expect(deserialized.takeProfit).toBe(original.takeProfit);
      expect(deserialized.reasoning).toBe(original.reasoning);
    });

    it('correctly round-trips UserRegisteredEvent', () => {
      const original = new UserRegisteredEvent({
        userId: 'user-789',
        email: 'test@example.com',
        username: 'testuser',
        referralCode: 'REF123',
      });

      const serialized = service.serialize(original);
      const deserialized = service.deserialize(serialized, UserRegisteredEvent);

      expect(deserialized.userId).toBe(original.userId);
      expect(deserialized.username).toBe(original.username);
      expect(deserialized.referralCode).toBe(original.referralCode);
      // Email is redacted in serialization, so won't match
    });

    it('correctly round-trips UserFollowedProviderEvent', () => {
      const original = new UserFollowedProviderEvent({
        userId: 'user-123',
        providerId: 'provider-456',
      });

      const serialized = service.serialize(original);
      const deserialized = service.deserialize(serialized, UserFollowedProviderEvent);

      expect(deserialized.userId).toBe(original.userId);
      expect(deserialized.providerId).toBe(original.providerId);
    });
  });

  describe('edge cases', () => {
    it('handles events with optional fields missing', () => {
      const event = new TradeExecutedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: TradeType.BUY,
        quantity: 100,
        price: 0.5,
        totalValue: 50,
        // signalId is optional and omitted
      });

      const serialized = service.serialize(event);
      const payload = JSON.parse(serialized.payload);

      expect(payload.signalId).toBeUndefined();
    });

    it('handles SignalValidatedEvent with confidence score', () => {
      const event = new SignalValidatedEvent({
        signalId: 'signal-123',
        status: SignalStatus.VALIDATED,
        validationNotes: 'Strong buy signal',
        confidenceScore: 0.85,
      });

      const serialized = service.serialize(event);
      const deserialized = service.deserialize(serialized, SignalValidatedEvent);

      expect(deserialized.confidenceScore).toBe(0.85);
      expect(deserialized.validationNotes).toBe('Strong buy signal');
    });

    it('handles TradeCancelledEvent', () => {
      const event = new TradeCancelledEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        reason: 'User requested cancellation',
      });

      const serialized = service.serialize(event);
      const deserialized = service.deserialize(serialized, TradeCancelledEvent);

      expect(deserialized.tradeId).toBe('trade-123');
      expect(deserialized.reason).toBe('User requested cancellation');
    });

    it('handles TradeFailedEvent', () => {
      const event = new TradeFailedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        reason: 'Insufficient balance',
      });

      const serialized = service.serialize(event);
      const deserialized = service.deserialize(serialized, TradeFailedEvent);

      expect(deserialized.tradeId).toBe('trade-123');
      expect(deserialized.reason).toBe('Insufficient balance');
    });

    it('handles UserProfileUpdatedEvent with changes', () => {
      const event = new UserProfileUpdatedEvent({
        userId: 'user-123',
        changes: { displayName: 'New Name', bio: 'Updated bio' },
      });

      const serialized = service.serialize(event);
      const deserialized = service.deserialize(serialized, UserProfileUpdatedEvent);

      expect(deserialized.userId).toBe('user-123');
      expect(deserialized.changes).toEqual({ displayName: 'New Name', bio: 'Updated bio' });
    });
  });

  describe('schema version compatibility', () => {
    it('accepts current schema version', () => {
      const event = new TradeExecutedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: TradeType.BUY,
        quantity: 100,
        price: 0.5,
        totalValue: 50,
      });

      const serialized = service.serialize(event);
      expect(serialized.schemaVersion).toBe(SCHEMA_VERSIONS.CURRENT);

      // Deserialization should work without warnings
      expect(() => service.deserialize(serialized, TradeExecutedEvent)).not.toThrow();
    });
  });

  describe('error messages', () => {
    it('provides clear validation error messages', () => {
      const event = new TradeExecutedEvent({
        tradeId: 'trade-123',
        userId: 'user-456',
        symbol: 'XLM/USDC',
        type: TradeType.BUY,
        quantity: -100,
        price: 0.5,
        totalValue: 50,
      });

      try {
        service.serialize(event);
        fail('Expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toContain('validation failed');
      }
    });

    it('includes field names in validation errors', () => {
      const event = new UserRegisteredEvent({
        userId: 'user-789',
        email: 'not-an-email',
        username: 'testuser',
      });

      const result = service.validateEvent(event);

      expect(result.valid).toBe(false);
      const errorMessages = result.errors.map(e =>
        e.constraints ? Object.values(e.constraints).join(', ') : 'validation failed',
      );
      expect(errorMessages.some(msg => msg.includes('email'))).toBe(true);
    });
  });
});
