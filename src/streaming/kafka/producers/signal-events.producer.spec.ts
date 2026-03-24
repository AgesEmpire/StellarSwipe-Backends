import { SignalEventsProducer } from './signal-events.producer';
import { KafkaService } from '../kafka.service';
import { KafkaTopics } from '../topics/kafka.topics';

describe('SignalEventsProducer', () => {
  let producer: SignalEventsProducer;
  let kafkaService: jest.Mocked<KafkaService>;

  beforeEach(() => {
    kafkaService = { emit: jest.fn() } as any;
    producer = new SignalEventsProducer(kafkaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('emitSignalCreated', () => {
    it('should emit to SIGNAL_CREATED topic with signalId as key', () => {
      const payload = {
        signalId: 'sig-1',
        providerId: 'prov-1',
        assetPair: 'XLM/USDC',
        action: 'BUY',
        targetPrice: 0.10,
        createdAt: new Date(),
      };

      producer.emitSignalCreated(payload);

      expect(kafkaService.emit).toHaveBeenCalledWith(
        KafkaTopics.SIGNAL_CREATED,
        expect.objectContaining({
          key: 'sig-1',
          value: payload,
          timestamp: expect.any(Date),
        }),
      );
    });
  });

  describe('emitSignalExpired', () => {
    it('should emit to SIGNAL_EXPIRED topic with signalId as key', () => {
      const payload = {
        signalId: 'sig-2',
        providerId: 'prov-1',
        expiredAt: new Date(),
      };

      producer.emitSignalExpired(payload);

      expect(kafkaService.emit).toHaveBeenCalledWith(
        KafkaTopics.SIGNAL_EXPIRED,
        expect.objectContaining({
          key: 'sig-2',
          value: payload,
        }),
      );
    });
  });

  describe('emitSignalTriggered', () => {
    it('should emit to SIGNAL_TRIGGERED topic with signalId as key', () => {
      const payload = {
        signalId: 'sig-3',
        userId: 'user-1',
        triggeredAt: new Date(),
      };

      producer.emitSignalTriggered(payload);

      expect(kafkaService.emit).toHaveBeenCalledWith(
        KafkaTopics.SIGNAL_TRIGGERED,
        expect.objectContaining({
          key: 'sig-3',
          value: payload,
        }),
      );
    });
  });
});
