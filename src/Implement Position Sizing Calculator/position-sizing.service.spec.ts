import { BadRequestException } from '@nestjs/common';
import { PositionSizingService } from './position-sizing.service';
import { SizingMethod } from '../dto/calculate-size.dto';

describe('PositionSizingService', () => {
  let service: PositionSizingService;

  beforeEach(() => {
    service = new PositionSizingService();
  });

  // ─── Fixed Percentage ──────────────────────────────────────────────────────
  describe('fixed percentage', () => {
    it('calculates 2% of $10,000 → $200', () => {
      const result = service.calculate({
        accountBalance: 10_000,
        riskPercentage: 2,
        signalId: 'sig-001',
        method: SizingMethod.FIXED,
      });
      expect(result.recommendedSize).toBe(200);
      expect(result.riskAmount).toBe(200);
      expect(result.method).toBe('fixed');
    });

    it('scales down by signal confidence', () => {
      const result = service.calculate({
        accountBalance: 10_000,
        riskPercentage: 2,
        signalId: 'sig-002',
        method: SizingMethod.FIXED,
        signalConfidence: 0.5,
      });
      expect(result.recommendedSize).toBe(100); // 200 * 0.5
    });

    it('caps at maxPositionPct', () => {
      const result = service.calculate({
        accountBalance: 10_000,
        riskPercentage: 5,
        signalId: 'sig-003',
        method: SizingMethod.FIXED,
        maxPositionPct: 4,
      });
      expect(result.recommendedSize).toBe(400); // capped at 4%
      expect(result.warnings).toContain(
        expect.stringContaining('capped at the maximum position limit'),
      );
    });
  });

  // ─── Kelly Criterion ───────────────────────────────────────────────────────
  describe('kelly criterion', () => {
    it('computes half-kelly position correctly', () => {
      // f* = (0.6*2 - 0.4*1) / 2 = (1.2 - 0.4) / 2 = 0.4
      // half-kelly = 0.2, but capped at 0.25 then halved → 0.125
      const result = service.calculate({
        accountBalance: 10_000,
        riskPercentage: 2,
        signalId: 'sig-004',
        method: SizingMethod.KELLY,
        winRate: 0.6,
        avgWin: 2,
        avgLoss: 1,
      });
      // f* = 0.4 → > 0.25 cap → applied = 0.25 * 0.5 = 0.125 → $1,250
      expect(result.recommendedSize).toBe(1250);
      expect(result.warnings).toContain(expect.stringContaining('Half-Kelly'));
    });

    it('falls back to fixed when kelly fraction is negative', () => {
      const result = service.calculate({
        accountBalance: 10_000,
        riskPercentage: 2,
        signalId: 'sig-005',
        method: SizingMethod.KELLY,
        winRate: 0.3,
        avgWin: 1,
        avgLoss: 3,
      });
      expect(result.recommendedSize).toBe(200); // fixed fallback
      expect(result.warnings?.[0]).toContain('negative expected value');
    });

    it('throws when kelly inputs are missing', () => {
      expect(() =>
        service.calculate({
          accountBalance: 10_000,
          riskPercentage: 2,
          signalId: 'sig-006',
          method: SizingMethod.KELLY,
        }),
      ).toThrow(BadRequestException);
    });
  });

  // ─── Volatility Adjusted ──────────────────────────────────────────────────
  describe('volatility adjusted', () => {
    it('reduces position size at high volatility', () => {
      const lowVol = service.calculate({
        accountBalance: 10_000,
        riskPercentage: 2,
        signalId: 'sig-007',
        method: SizingMethod.VOLATILITY,
        assetVolatility: 0.1,
      });
      const highVol = service.calculate({
        accountBalance: 10_000,
        riskPercentage: 2,
        signalId: 'sig-008',
        method: SizingMethod.VOLATILITY,
        assetVolatility: 0.5,
      });
      expect(lowVol.recommendedSize).toBeGreaterThan(highVol.recommendedSize);
    });

    it('warns on extreme volatility > 100%', () => {
      const result = service.calculate({
        accountBalance: 10_000,
        riskPercentage: 2,
        signalId: 'sig-009',
        method: SizingMethod.VOLATILITY,
        assetVolatility: 1.5,
        maxPositionPct: 100,
      });
      expect(result.warnings).toContain(expect.stringContaining('Extreme volatility'));
    });

    it('throws when assetVolatility is missing', () => {
      expect(() =>
        service.calculate({
          accountBalance: 10_000,
          riskPercentage: 2,
          signalId: 'sig-010',
          method: SizingMethod.VOLATILITY,
        }),
      ).toThrow(BadRequestException);
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('throws on insufficient balance', () => {
      expect(() =>
        service.calculate({
          accountBalance: 50,
          riskPercentage: 2,
          signalId: 'sig-011',
          method: SizingMethod.FIXED,
        }),
      ).toThrow(BadRequestException);
    });
  });
});
