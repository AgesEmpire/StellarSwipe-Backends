import { SignalEventsConsumer } from './signal-events.consumer';
import { KafkaService, KafkaMessage } from '../kafka.service';
import { KafkaTopics } from '../topics/kafka.topics';
import {
  SignalCreatedPayload,
  SignalExpiredPayload,
  SignalTriggeredPayload,
} from '../producers/signal-events.producer';

describe('SignalEventsConsumer', () => {
  let consumer: SignalEventsConsumer;
  let kafkaService: jest.Mocked<KafkaService>;

  beforeEach(() => {
    kafkaService = { subscribe: jest.fn() } as any;
    consumer = new SignalEventsConsumer(kafkaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('onModuleInit', () => {
    it('should subscribe to SIGNAL_CREATED, SIGNAL_EXPIRED and SIGNAL_TRIGGERED topics', () => {
      consumer.onModuleInit();

      expect(kafkaService.subscribe).toHaveBeenCalledTimes(3);
      expect(kafkaService.subscribe).toHaveBeenCalledWith(
        KafkaTopics.SIGNAL_CREATED,
        consumer.GROUP_ID,
        expect.any(Function),
      );
      expect(kafkaService.subscribe).toHaveBeenCalledWith(
        KafkaTopics.SIGNAL_EXPIRED,
        consumer.GROUP_ID,
        expect.any(Function),
      );
      expect(kafkaService.subscribe).toHaveBeenCalledWith(
        KafkaTopics.SIGNAL_TRIGGERED,
        consumer.GROUP_ID,
        expect.any(Function),
      );
    });

    it('should use the correct consumer group id', () => {
      expect(consumer.GROUP_ID).toBe('signal-events-consumer-group');
    });
  });

  describe('handleSignalCreated', () => {
    it('should log signal created message', () => {
      const message: KafkaMessage<SignalCreatedPayload> = {
        key: 'sig-1',
        value: {
          signalId: 'sig-1',
          providerId: 'prov-1',
          assetPair: 'XLM/USDC',
          action: 'BUY',
          targetPrice: 0.10,
          createdAt: new Date(),
        },
        timestamp: new Date(),
      };

      expect(() => consumer.handleSignalCreated(message)).not.toThrow();
    });
  });

  describe('handleSignalExpired', () => {
    it('should log signal expired message', () => {
      const message: KafkaMessage<SignalExpiredPayload> = {
        key: 'sig-2',
        value: {
          signalId: 'sig-2',
          providerId: 'prov-1',
          expiredAt: new Date(),
        },
        timestamp: new Date(),
      };

      expect(() => consumer.handleSignalExpired(message)).not.toThrow();
    });
  });

  describe('handleSignalTriggered', () => {
    it('should log signal triggered message', () => {
      const message: KafkaMessage<SignalTriggeredPayload> = {
        key: 'sig-3',
        value: {
          signalId: 'sig-3',
          userId: 'user-1',
          triggeredAt: new Date(),
        },
        timestamp: new Date(),
      };

      expect(() => consumer.handleSignalTriggered(message)).not.toThrow();
    });
  });
});
