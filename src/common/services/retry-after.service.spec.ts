import { Test, TestingModule } from '@nestjs/testing';
import { RetryAfterService } from './retry-after.service';

describe('RetryAfterService', () => {
  let service: RetryAfterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RetryAfterService],
    }).compile();

    service = module.get<RetryAfterService>(RetryAfterService);
  });

  describe('computeRetryAfter', () => {
    it('should return 0 if reset time has passed', () => {
      const now = Date.now();
      const window = { resetTime: now - 1000 };

      const result = service.computeRetryAfter(window, now);

      expect(result).toBe(0);
    });

    it('should compute seconds until reset', () => {
      const now = Date.now();
      const resetTime = now + 30500;
      const window = { resetTime };

      const result = service.computeRetryAfter(window, now);

      expect(result).toBe(31);
    });

    it('should round up fractional seconds', () => {
      const now = Date.now();
      const resetTime = now + 1100;
      const window = { resetTime };

      const result = service.computeRetryAfter(window, now);

      expect(result).toBe(2);
    });

    it('should use current time if not provided', () => {
      const resetTime = Date.now() + 5000;
      const window = { resetTime };

      const result = service.computeRetryAfter(window);

      expect(result).toBeGreaterThanOrEqual(4);
      expect(result).toBeLessThanOrEqual(6);
    });
  });

  describe('formatRetryAfter', () => {
    it('should format seconds as string', () => {
      const result = service.formatRetryAfter(60);

      expect(result).toBe('60');
      expect(typeof result).toBe('string');
    });

    it('should handle zero seconds', () => {
      const result = service.formatRetryAfter(0);

      expect(result).toBe('0');
    });

    it('should handle large values', () => {
      const result = service.formatRetryAfter(3600);

      expect(result).toBe('3600');
    });
  });

  describe('fromResetTimestamp', () => {
    it('should compute retry-after from reset timestamp', () => {
      const now = Date.now();
      const resetTime = now + 45000;

      const result = service.fromResetTimestamp(resetTime, now);

      expect(result).toBe('45');
    });

    it('should use current time if not provided', () => {
      const resetTime = Date.now() + 10000;

      const result = service.fromResetTimestamp(resetTime);

      expect(parseInt(result, 10)).toBeGreaterThanOrEqual(9);
      expect(parseInt(result, 10)).toBeLessThanOrEqual(11);
    });

    it('should return zero for past timestamps', () => {
      const now = Date.now();
      const resetTime = now - 5000;

      const result = service.fromResetTimestamp(resetTime, now);

      expect(result).toBe('0');
    });
  });

  describe('fromResetDelta', () => {
    it('should compute retry-after from delta in milliseconds', () => {
      const result = service.fromResetDelta(60000);

      expect(result).toBe('60');
    });

    it('should round up fractional seconds', () => {
      const result = service.fromResetDelta(30500);

      expect(result).toBe('31');
    });

    it('should return zero for negative deltas', () => {
      const result = service.fromResetDelta(-5000);

      expect(result).toBe('0');
    });

    it('should handle small deltas', () => {
      const result = service.fromResetDelta(100);

      expect(result).toBe('1');
    });
  });
});
