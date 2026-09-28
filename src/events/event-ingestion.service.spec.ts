import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import {
  ForbiddenException,
  PayloadTooLargeException,
  TooManyRequestsException,
} from '@nestjs/common';
import { EventIngestionService, IngestEventDto } from './event-ingestion.service';

const makeCacheMock = () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
});

const makeConfigMock = (overrides: Record<string, unknown> = {}) => ({
  get: jest.fn((key: string) => {
    const map: Record<string, unknown> = {
      'ingestion.allowedSources': 'src-a,src-b',
      'ingestion.maxBatchSize': 5,
      'ingestion.maxPayloadBytes': 100,
      'ingestion.rateWindowMs': 60_000,
      'ingestion.rateLimit': 3,
      'ingestion.circuitBreakerThreshold': 0.5,
      'ingestion.circuitBreakerWindowMs': 30_000,
      ...overrides,
    };
    return map[key];
  }),
});

const makeEvent = (overrides: Partial<IngestEventDto> = {}): IngestEventDto => ({
  sourceId: 'src-a',
  eventType: 'trade.executed',
  payload: { id: '1' },
  ...overrides,
});

async function buildService(configOverrides: Record<string, unknown> = {}) {
  const cache = makeCacheMock();
  const module = await Test.createTestingModule({
    providers: [
      EventIngestionService,
      { provide: CACHE_MANAGER, useValue: cache },
      { provide: ConfigService, useValue: makeConfigMock(configOverrides) },
    ],
  }).compile();

  return { svc: module.get(EventIngestionService), cache };
}

describe('EventIngestionService', () => {
  describe('ingestOne()', () => {
    it('accepts a valid event from an allowed source', async () => {
      const { svc } = await buildService();
      await expect(svc.ingestOne(makeEvent())).resolves.not.toThrow();
    });

    it('rejects events from unknown sources', async () => {
      const { svc } = await buildService();
      await expect(
        svc.ingestOne(makeEvent({ sourceId: 'unknown-src' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects oversized payloads', async () => {
      const { svc } = await buildService();
      const bigPayload = { data: 'x'.repeat(200) };
      await expect(
        svc.ingestOne(makeEvent({ payload: bigPayload })),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('rejects when rate limit is exceeded', async () => {
      const { svc, cache } = await buildService();
      // Simulate counter already at limit
      cache.get.mockResolvedValueOnce(3); // rate counter = limit
      await expect(svc.ingestOne(makeEvent())).rejects.toThrow(TooManyRequestsException);
    });

    it('rejects when circuit breaker is open', async () => {
      const { svc, cache } = await buildService();
      // errors=5, total=8 → 0.625 > 0.5 threshold
      cache.get
        .mockResolvedValueOnce(0)   // rate counter OK
        .mockResolvedValueOnce(5)   // errors
        .mockResolvedValueOnce(8);  // total
      await expect(svc.ingestOne(makeEvent())).rejects.toThrow(TooManyRequestsException);
    });

    it('allows all sources when allowedSources is empty', async () => {
      const { svc } = await buildService({ 'ingestion.allowedSources': '' });
      await expect(
        svc.ingestOne(makeEvent({ sourceId: 'any-source' })),
      ).resolves.not.toThrow();
    });
  });

  describe('ingestBatch()', () => {
    it('returns accepted/rejected counts', async () => {
      const { svc, cache } = await buildService();
      // First event OK, second event hits rate limit
      cache.get
        .mockResolvedValueOnce(null) // circuit errors
        .mockResolvedValueOnce(null) // circuit total
        .mockResolvedValueOnce(0)    // rate counter event 1
        .mockResolvedValueOnce(3)    // rate counter event 2 → over limit
        .mockResolvedValue(null);

      const result = await svc.ingestBatch([makeEvent(), makeEvent()]);
      expect(result.accepted + result.rejected).toBe(2);
    });

    it('throws when batch size exceeds limit', async () => {
      const { svc } = await buildService();
      const events = Array.from({ length: 6 }, () => makeEvent());
      await expect(svc.ingestBatch(events)).rejects.toThrow(PayloadTooLargeException);
    });

    it('returns zero counts for empty batch', async () => {
      const { svc } = await buildService();
      expect(await svc.ingestBatch([])).toEqual({ accepted: 0, rejected: 0 });
    });
  });

  describe('getRateCount()', () => {
    it('returns current counter from cache', async () => {
      const { svc, cache } = await buildService();
      cache.get.mockResolvedValueOnce(7);
      expect(await svc.getRateCount('src-a')).toBe(7);
    });

    it('returns 0 when no counter exists', async () => {
      const { svc, cache } = await buildService();
      cache.get.mockResolvedValueOnce(null);
      expect(await svc.getRateCount('src-a')).toBe(0);
    });
  });
});
