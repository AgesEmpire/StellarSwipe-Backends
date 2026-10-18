import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WebhookReplayGuardService, WEBHOOK_TOLERANCE_SECONDS } from './webhook-replay-guard.service';

describe('WebhookReplayGuardService', () => {
  let service: WebhookReplayGuardService;
  let manager: { query: jest.Mock };
  let dataSource: {
    transaction: jest.Mock;
    getRepository: jest.Mock;
  };
  let repository: { delete: jest.Mock };

  beforeEach(() => {
    manager = { query: jest.fn() };
    repository = { delete: jest.fn().mockResolvedValue(undefined) };
    dataSource = {
      transaction: jest.fn(async (fn: (m: typeof manager) => Promise<unknown>) => fn(manager)),
      getRepository: jest.fn().mockReturnValue(repository),
    };

    service = new WebhookReplayGuardService(dataSource as unknown as DataSource);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.clearAllMocks());

  describe('assertFreshTimestamp — clock skew tolerance', () => {
    it('accepts a timestamp within the tolerance window', () => {
      const now = Date.now();
      const nowSeconds = Math.floor(now / 1000);

      expect(() => service.assertFreshTimestamp(nowSeconds, now)).not.toThrow();
    });

    it('accepts a timestamp at the edge of the tolerance window', () => {
      const now = Date.now();
      const edgeSeconds = Math.floor((now - WEBHOOK_TOLERANCE_SECONDS * 1000) / 1000);

      expect(() => service.assertFreshTimestamp(edgeSeconds, now)).not.toThrow();
    });

    it('rejects an expired (too old) timestamp', () => {
      const now = Date.now();
      const expiredSeconds = Math.floor((now - (WEBHOOK_TOLERANCE_SECONDS + 60) * 1000) / 1000);

      expect(() => service.assertFreshTimestamp(expiredSeconds, now)).toThrow(BadRequestException);
      expect(() => service.assertFreshTimestamp(expiredSeconds, now)).toThrow(
        'Webhook timestamp outside tolerance window',
      );
    });

    it('rejects a timestamp too far in the future (clock skew beyond tolerance)', () => {
      const now = Date.now();
      const futureSeconds = Math.floor((now + (WEBHOOK_TOLERANCE_SECONDS + 60) * 1000) / 1000);

      expect(() => service.assertFreshTimestamp(futureSeconds, now)).toThrow(BadRequestException);
    });

    it('rejects a malformed timestamp', () => {
      expect(() => service.assertFreshTimestamp('not-a-date')).toThrow(BadRequestException);
      expect(() => service.assertFreshTimestamp('not-a-date')).toThrow('Invalid webhook timestamp');
    });

    it('accepts an ISO string timestamp within tolerance', () => {
      const now = Date.now();
      const iso = new Date(now - 10_000).toISOString();

      expect(() => service.assertFreshTimestamp(iso, now)).not.toThrow();
    });
  });

  describe('processOnce — replay persistence', () => {
    const delivery = { source: 'provider-a', deliveryId: 'evt-1', timestamp: Math.floor(Date.now() / 1000) };

    it('claims an unseen delivery id and runs the handler', async () => {
      manager.query.mockResolvedValue([{ delivery_id: delivery.deliveryId }]);
      const handler = jest.fn().mockResolvedValue('handled');

      const result = await service.processOnce(delivery, handler);

      expect(result).toEqual({ status: 'processed', result: 'handled' });
      expect(handler).toHaveBeenCalledWith(manager);
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO processed_webhook_events'),
        [delivery.source, delivery.deliveryId, expect.any(Date)],
      );
    });

    it('acknowledges a concurrent duplicate without running the handler', async () => {
      // ON CONFLICT DO NOTHING returns zero rows when another in-flight
      // transaction already claimed the same (source, deliveryId) pair —
      // simulating two concurrent deliveries of the same event.
      manager.query.mockResolvedValue([]);
      const handler = jest.fn();

      const result = await service.processOnce(delivery, handler);

      expect(result).toEqual({ status: 'duplicate' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('rejects a replayed (expired) delivery before opening a transaction', async () => {
      const expiredDelivery = {
        ...delivery,
        timestamp: Math.floor(Date.now() / 1000) - WEBHOOK_TOLERANCE_SECONDS - 60,
      };
      const handler = jest.fn();

      await expect(service.processOnce(expiredDelivery, handler)).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it('propagates handler failures so the claim rolls back and the sender can retry', async () => {
      manager.query.mockResolvedValue([{ delivery_id: delivery.deliveryId }]);
      const handler = jest.fn().mockRejectedValue(new Error('downstream failure'));

      await expect(service.processOnce(delivery, handler)).rejects.toThrow('downstream failure');
    });
  });

  describe('pruneExpired', () => {
    it('deletes processed-event records older than the retention cutoff', async () => {
      await service.pruneExpired();

      expect(dataSource.getRepository).toHaveBeenCalled();
      expect(repository.delete).toHaveBeenCalledWith({
        processedAt: expect.objectContaining({ _type: 'lessThan' }),
      });
    });
  });
});
