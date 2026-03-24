import { KafkaService, KafkaMessage } from './kafka.service';
import { KafkaTopics } from './topics/kafka.topics';

describe('KafkaService', () => {
  let service: KafkaService;

  beforeEach(() => {
    service = new KafkaService();
  });

  describe('emit', () => {
    it('should emit a message to the given topic', () => {
      const received: KafkaMessage[] = [];
      service.subscribe(KafkaTopics.TRADE_EXECUTED, 'test-group', (msg) => {
        received.push(msg);
      });

      const message: KafkaMessage = {
        key: 'trade-1',
        value: { amount: 100 },
        timestamp: new Date(),
      };
      service.emit(KafkaTopics.TRADE_EXECUTED, message);

      expect(received).toHaveLength(1);
      expect(received[0].key).toBe('trade-1');
      expect(received[0].topic).toBe(KafkaTopics.TRADE_EXECUTED);
    });

    it('should not deliver message to a different topic subscriber', () => {
      const received: KafkaMessage[] = [];
      service.subscribe(KafkaTopics.SIGNAL_CREATED, 'test-group', (msg) => {
        received.push(msg);
      });

      service.emit(KafkaTopics.TRADE_EXECUTED, {
        key: 'trade-1',
        value: {},
        timestamp: new Date(),
      });

      expect(received).toHaveLength(0);
    });

    it('should deliver to multiple subscribers on the same topic', () => {
      const calls: number[] = [];
      service.subscribe(KafkaTopics.TRADE_EXECUTED, 'group-a', () => {
        calls.push(1);
      });
      service.subscribe(KafkaTopics.TRADE_EXECUTED, 'group-b', () => {
        calls.push(2);
      });

      service.emit(KafkaTopics.TRADE_EXECUTED, {
        key: 'k',
        value: {},
        timestamp: new Date(),
      });

      expect(calls).toEqual([1, 2]);
    });
  });

  describe('subscribe', () => {
    it('should register a new consumer group', () => {
      service.subscribe(KafkaTopics.TRADE_EXECUTED, 'group-1', jest.fn());

      const groups = service.getConsumerGroups();
      expect(groups.has('group-1')).toBe(true);
      expect(groups.get('group-1')!.has(KafkaTopics.TRADE_EXECUTED)).toBe(true);
    });

    it('should add topic to an existing consumer group', () => {
      service.subscribe(KafkaTopics.TRADE_EXECUTED, 'group-1', jest.fn());
      service.subscribe(KafkaTopics.TRADE_CANCELLED, 'group-1', jest.fn());

      const groups = service.getConsumerGroups();
      expect(groups.get('group-1')!.size).toBe(2);
    });

    it('should increment subscriber count for topic', () => {
      service.subscribe(KafkaTopics.SIGNAL_CREATED, 'group-1', jest.fn());
      service.subscribe(KafkaTopics.SIGNAL_CREATED, 'group-2', jest.fn());

      expect(service.getTopicSubscriberCount(KafkaTopics.SIGNAL_CREATED)).toBe(
        2,
      );
    });
  });

  describe('unsubscribe', () => {
    it('should remove a handler from the topic', () => {
      const handler = jest.fn();
      service.subscribe(KafkaTopics.TRADE_EXECUTED, 'group-1', handler);

      expect(service.getTopicSubscriberCount(KafkaTopics.TRADE_EXECUTED)).toBe(
        1,
      );

      service.unsubscribe(KafkaTopics.TRADE_EXECUTED, handler);

      expect(service.getTopicSubscriberCount(KafkaTopics.TRADE_EXECUTED)).toBe(
        0,
      );
    });

    it('should not invoke handler after unsubscribing', () => {
      const handler = jest.fn();
      service.subscribe(KafkaTopics.TRADE_EXECUTED, 'group-1', handler);
      service.unsubscribe(KafkaTopics.TRADE_EXECUTED, handler);

      service.emit(KafkaTopics.TRADE_EXECUTED, {
        key: 'k',
        value: {},
        timestamp: new Date(),
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('getConsumerGroups', () => {
    it('should return empty map when no subscriptions', () => {
      expect(service.getConsumerGroups().size).toBe(0);
    });

    it('should return all registered groups', () => {
      service.subscribe(KafkaTopics.TRADE_EXECUTED, 'group-a', jest.fn());
      service.subscribe(KafkaTopics.SIGNAL_CREATED, 'group-b', jest.fn());

      expect(service.getConsumerGroups().size).toBe(2);
    });
  });

  describe('getTopicSubscriberCount', () => {
    it('should return 0 for topic with no subscribers', () => {
      expect(
        service.getTopicSubscriberCount(KafkaTopics.PRICE_UPDATED),
      ).toBe(0);
    });
  });
});
