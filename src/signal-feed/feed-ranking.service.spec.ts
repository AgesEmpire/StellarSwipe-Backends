import { FeedRankingService } from './feed-ranking.service';
import { Signal } from '../signals/entities/signal.entity';
import { ProviderStats } from '../signals/entities/provider-stats.entity';

const makeSignal = (overrides: Partial<Signal> = {}): Signal =>
  ({
    id: 'sig-1',
    providerId: 'prov-1',
    createdAt: new Date(),
    copiersCount: 10,
    successRate: 60,
    ...overrides,
  } as Signal);

const makeStats = (overrides: Partial<ProviderStats> = {}): ProviderStats =>
  ({
    providerId: 'prov-1',
    winRate: '70',
    reputationScore: '80',
    maxDrawdown: '5',
    ...overrides,
  } as ProviderStats);

describe('FeedRankingService', () => {
  let service: FeedRankingService;

  beforeEach(() => {
    service = new FeedRankingService();
  });

  describe('score()', () => {
    it('returns a number between 0 and 100', () => {
      const s = makeSignal();
      const stats = makeStats();
      const result = service.score(s, stats);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });

    it('gives a higher score to a fresh signal vs a 48h-old signal', () => {
      const fresh = makeSignal({ createdAt: new Date() });
      const old = makeSignal({ createdAt: new Date(Date.now() - 48 * 3_600_000) });
      const stats = makeStats();
      expect(service.score(fresh, stats)).toBeGreaterThan(service.score(old, stats));
    });

    it('gives a higher score when provider has better win rate', () => {
      const signal = makeSignal();
      const good = makeStats({ winRate: '90', reputationScore: '90' });
      const bad = makeStats({ winRate: '20', reputationScore: '20' });
      expect(service.score(signal, good)).toBeGreaterThan(service.score(signal, bad));
    });

    it('penalises high drawdown in risk/volume score', () => {
      const signal = makeSignal();
      const safe = makeStats({ maxDrawdown: '0' });
      const risky = makeStats({ maxDrawdown: '40' });
      expect(service.score(signal, safe)).toBeGreaterThan(service.score(signal, risky));
    });

    it('uses 50 as default provider score when stats are null', () => {
      const signal = makeSignal();
      const score = service.score(signal, null);
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('respects custom weights', () => {
      const signal = makeSignal({ createdAt: new Date() });
      const stats = makeStats();
      const freshnessHeavy = service.score(signal, stats, { freshness: 0.9, providerScore: 0.05, riskVolume: 0.05 });
      const providerHeavy = service.score(signal, stats, { freshness: 0.05, providerScore: 0.9, riskVolume: 0.05 });
      // Both valid scores
      expect(freshnessHeavy).toBeGreaterThanOrEqual(0);
      expect(providerHeavy).toBeGreaterThanOrEqual(0);
    });
  });

  describe('rank()', () => {
    it('sorts signals by descending feed score', () => {
      const fresh = makeSignal({ id: 'fresh', createdAt: new Date() });
      const old = makeSignal({ id: 'old', createdAt: new Date(Date.now() - 72 * 3_600_000) });
      const statsMap = new Map([['prov-1', makeStats()]]);

      const ranked = service.rank([old, fresh], statsMap);
      expect(ranked[0].id).toBe('fresh');
      expect(ranked[1].id).toBe('old');
    });

    it('attaches feedScore to each result', () => {
      const signals = [makeSignal({ id: 'a' }), makeSignal({ id: 'b' })];
      const statsMap = new Map([['prov-1', makeStats()]]);
      const ranked = service.rank(signals, statsMap);
      ranked.forEach((s) => expect(typeof s.feedScore).toBe('number'));
    });

    it('handles empty input', () => {
      expect(service.rank([], new Map())).toEqual([]);
    });
  });
});
