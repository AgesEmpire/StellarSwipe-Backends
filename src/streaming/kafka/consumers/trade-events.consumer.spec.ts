import { TradeEventsConsumer } from './trade-events.consumer';
import { KafkaService, KafkaMessage } from '../kafka.service';
import { KafkaTopics } from '../topics/kafka.topics';
import {
  TradeExecutedPayload,
  TradeCancelledPayload,
  TradeScheduledPayload,
} from '../producers/trade-events.producer';

describe('TradeEventsConsumer', () => {
  let consumer: TradeEventsConsumer;
  let kafkaService: jest.Mocked<KafkaService>;

  beforeEach(() => {
    kafkaService = { subscribe: jest.fn() } as any;
    consumer = new TradeEventsConsumer(kafkaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('onModuleInit', () => {
    it('should subscribe to TRADE_EXECUTED, TRADE_CANCELLED and TRADE_SCHEDULED topics', () => {
      consumer.onModuleInit();

      expect(kafkaService.subscribe).toHaveBeenCalledTimes(3);
      expect(kafkaService.subscribe).toHaveBeenCalledWith(
        KafkaTopics.TRADE_EXECUTED,
        consumer.GROUP_ID,
        expect.any(Function),
      );
      expect(kafkaService.subscribe).toHaveBeenCalledWith(
        KafkaTopics.TRADE_CANCELLED,
        consumer.GROUP_ID,
        expect.any(Function),
      );
      expect(kafkaService.subscribe).toHaveBeenCalledWith(
        KafkaTopics.TRADE_SCHEDULED,
        consumer.GROUP_ID,
        expect.any(Function),
      );
    });

    it('should use the correct consumer group id', () => {
      expect(consumer.GROUP_ID).toBe('trade-events-consumer-group');
    });
  });

  describe('handleTradeExecuted', () => {
    it('should log trade executed message', () => {
      const message: KafkaMessage<TradeExecutedPayload> = {
        key: 'trade-1',
        value: {
          tradeId: 'trade-1',
          userId: 'user-1',
          assetPair: 'XLM/USDC',
          amount: 100,
          price: 0.09,
          executedAt: new Date(),
        },
        timestamp: new Date(),
      };

      expect(() => consumer.handleTradeExecuted(message)).not.toThrow();
    });
  });

  describe('handleTradeCancelled', () => {
    it('should log trade cancelled message with reason', () => {
      const message: KafkaMessage<TradeCancelledPayload> = {
        key: 'trade-2',
        value: {
          tradeId: 'trade-2',
          userId: 'user-1',
          reason: 'User requested',
          cancelledAt: new Date(),
        },
        timestamp: new Date(),
      };

      expect(() => consumer.handleTradeCancelled(message)).not.toThrow();
    });

    it('should handle cancelled message without reason', () => {
      const message: KafkaMessage<TradeCancelledPayload> = {
        key: 'trade-3',
        value: {
          tradeId: 'trade-3',
          userId: 'user-2',
          cancelledAt: new Date(),
        },
        timestamp: new Date(),
      };

      expect(() => consumer.handleTradeCancelled(message)).not.toThrow();
    });
  });

  describe('handleTradeScheduled', () => {
    it('should log trade scheduled message', () => {
      const message: KafkaMessage<TradeScheduledPayload> = {
        key: 'sched-1',
        value: {
          scheduleId: 'sched-1',
          userId: 'user-1',
          assetPair: 'XLM/USDC',
          amount: 200,
          scheduledAt: new Date(),
        },
        timestamp: new Date(),
      };

      expect(() => consumer.handleTradeScheduled(message)).not.toThrow();
    });
  });
});
