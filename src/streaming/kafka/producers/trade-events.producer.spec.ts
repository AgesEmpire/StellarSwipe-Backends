import { TradeEventsProducer } from './trade-events.producer';
import { KafkaService } from '../kafka.service';
import { KafkaTopics } from '../topics/kafka.topics';

describe('TradeEventsProducer', () => {
  let producer: TradeEventsProducer;
  let kafkaService: jest.Mocked<KafkaService>;

  beforeEach(() => {
    kafkaService = { emit: jest.fn() } as any;
    producer = new TradeEventsProducer(kafkaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('emitTradeExecuted', () => {
    it('should emit to TRADE_EXECUTED topic with correct key and value', () => {
      const payload = {
        tradeId: 'trade-1',
        userId: 'user-1',
        assetPair: 'XLM/USDC',
        amount: 500,
        price: 0.095,
        executedAt: new Date(),
      };

      producer.emitTradeExecuted(payload);

      expect(kafkaService.emit).toHaveBeenCalledWith(
        KafkaTopics.TRADE_EXECUTED,
        expect.objectContaining({
          key: 'trade-1',
          value: payload,
          timestamp: expect.any(Date),
        }),
      );
    });
  });

  describe('emitTradeCancelled', () => {
    it('should emit to TRADE_CANCELLED topic with correct key and value', () => {
      const payload = {
        tradeId: 'trade-2',
        userId: 'user-1',
        reason: 'User requested',
        cancelledAt: new Date(),
      };

      producer.emitTradeCancelled(payload);

      expect(kafkaService.emit).toHaveBeenCalledWith(
        KafkaTopics.TRADE_CANCELLED,
        expect.objectContaining({
          key: 'trade-2',
          value: payload,
        }),
      );
    });

    it('should emit without reason when reason is undefined', () => {
      const payload = {
        tradeId: 'trade-3',
        userId: 'user-2',
        cancelledAt: new Date(),
      };

      producer.emitTradeCancelled(payload);

      expect(kafkaService.emit).toHaveBeenCalledWith(
        KafkaTopics.TRADE_CANCELLED,
        expect.objectContaining({ key: 'trade-3' }),
      );
    });
  });

  describe('emitTradeScheduled', () => {
    it('should emit to TRADE_SCHEDULED topic with scheduleId as key', () => {
      const payload = {
        scheduleId: 'sched-1',
        userId: 'user-1',
        assetPair: 'XLM/USDC',
        amount: 200,
        scheduledAt: new Date(),
      };

      producer.emitTradeScheduled(payload);

      expect(kafkaService.emit).toHaveBeenCalledWith(
        KafkaTopics.TRADE_SCHEDULED,
        expect.objectContaining({
          key: 'sched-1',
          value: payload,
        }),
      );
    });
  });
});
