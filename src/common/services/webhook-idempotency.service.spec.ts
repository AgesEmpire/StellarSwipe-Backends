import { BadRequestException } from '@nestjs/common';
import { WebhookIdempotencyService } from './webhook-idempotency.service';

function makeUniqueViolation(): any {
  const err: any = new Error('duplicate key value violates unique constraint');
  err.code = '23505';
  return err;
}

describe('WebhookIdempotencyService', () => {
  let repo: {
    insert: jest.Mock;
    findOne: jest.Mock;
  };
  let service: WebhookIdempotencyService;

  beforeEach(() => {
    repo = {
      insert: jest.fn(),
      findOne: jest.fn(),
    };
    service = new WebhookIdempotencyService(repo as any);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  describe('first delivery', () => {
    it('records the (provider, eventId) pair and returns true', async () => {
      repo.insert.mockResolvedValue({ identifiers: [{ id: 'row-1' }] });

      const result = await service.markProcessed('stripe', 'evt_123');

      expect(result).toBe(true);
      expect(repo.insert).toHaveBeenCalledWith({ provider: 'stripe', eventId: 'evt_123' });
    });

    it('trims surrounding whitespace before persisting', async () => {
      repo.insert.mockResolvedValue({});

      await service.markProcessed('paystack', '  evt_456  ');

      expect(repo.insert).toHaveBeenCalledWith({ provider: 'paystack', eventId: 'evt_456' });
    });
  });

  describe('replay / redelivery', () => {
    it('returns false when the same (provider, eventId) is replayed (unique violation)', async () => {
      repo.insert.mockRejectedValue(makeUniqueViolation());

      const result = await service.markProcessed('mpesa', 'ws_CO_1234');

      expect(result).toBe(false);
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('mpesa/ws_CO_1234'),
      );
    });

    it('treats the same eventId from two different providers independently', async () => {
      repo.insert.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      const first = await service.markProcessed('stripe', 'evt_shared');
      const second = await service.markProcessed('paystack', 'evt_shared');

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(repo.insert).toHaveBeenCalledTimes(2);
    });

    it('rethrows non-unique-violation database errors instead of swallowing them', async () => {
      const dbError = new Error('connection terminated unexpectedly');
      repo.insert.mockRejectedValue(dbError);

      await expect(service.markProcessed('stripe', 'evt_789')).rejects.toThrow(dbError);
    });

    it('simulates concurrent redelivery: only the first insert wins', async () => {
      repo.insert
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(makeUniqueViolation());

      const [first, second] = await Promise.all([
        service.markProcessed('stripe', 'evt_concurrent'),
        service.markProcessed('stripe', 'evt_concurrent'),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
    });
  });

  describe('malformed event identifiers', () => {
    it.each([
      ['empty string', ''],
      ['whitespace only', '   '],
    ])('rejects %s', async (_label, eventId) => {
      await expect(service.markProcessed('stripe', eventId)).rejects.toThrow(BadRequestException);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('rejects a non-string eventId', async () => {
      await expect(
        service.markProcessed('stripe', 12345 as unknown as string),
      ).rejects.toThrow(BadRequestException);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('rejects a null eventId', async () => {
      await expect(
        service.markProcessed('stripe', null as unknown as string),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an undefined eventId', async () => {
      await expect(
        service.markProcessed('stripe', undefined as unknown as string),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an implausibly long eventId', async () => {
      const tooLong = 'e'.repeat(256);
      await expect(service.markProcessed('stripe', tooLong)).rejects.toThrow(BadRequestException);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('accepts an eventId exactly at the length boundary', async () => {
      repo.insert.mockResolvedValue({});
      const atBoundary = 'e'.repeat(255);

      const result = await service.markProcessed('stripe', atBoundary);

      expect(result).toBe(true);
    });
  });

  describe('wasProcessed', () => {
    it('returns true when a matching record exists', async () => {
      repo.findOne.mockResolvedValue({ id: 'row-1', provider: 'stripe', eventId: 'evt_1' });

      const result = await service.wasProcessed('stripe', 'evt_1');

      expect(result).toBe(true);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { provider: 'stripe', eventId: 'evt_1' },
      });
    });

    it('returns false when no record exists', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.wasProcessed('stripe', 'evt_missing');

      expect(result).toBe(false);
    });

    it('validates the eventId before querying', async () => {
      await expect(service.wasProcessed('stripe', '')).rejects.toThrow(BadRequestException);
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });
});
