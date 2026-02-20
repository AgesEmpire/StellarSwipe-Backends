import { Test, TestingModule } from '@nestjs/testing';
import { StatisticalAnalysisService } from './statistical-analysis.service';

describe('StatisticalAnalysisService', () => {
  let service: StatisticalAnalysisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StatisticalAnalysisService],
    }).compile();

    service = module.get<StatisticalAnalysisService>(StatisticalAnalysisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculateMean', () => {
    it('should return 0 for empty array', () => {
      expect(service.calculateMean([])).toBe(0);
    });

    it('should calculate mean correctly', () => {
      expect(service.calculateMean([1, 2, 3, 4, 5])).toBe(3);
      expect(service.calculateMean([10, 20, 30])).toBe(20);
    });
  });

  describe('calculateStandardDeviation', () => {
    it('should return 0 for arrays with less than 2 elements', () => {
      expect(service.calculateStandardDeviation([])).toBe(0);
      expect(service.calculateStandardDeviation([5])).toBe(0);
    });

    it('should calculate standard deviation correctly', () => {
      const result = service.calculateStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9]);
      expect(result).toBeCloseTo(2.138, 2);
    });
  });

  describe('calculatePercentile', () => {
    it('should return 0 for empty array', () => {
      expect(service.calculatePercentile([], 50)).toBe(0);
    });

    it('should calculate percentile correctly', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(service.calculatePercentile(data, 50)).toBe(5);
      expect(service.calculatePercentile(data, 95)).toBe(10);
    });
  });

  describe('calculateCovariance', () => {
    it('should return 0 for mismatched arrays', () => {
      expect(service.calculateCovariance([1, 2], [1])).toBe(0);
    });

    it('should return 0 for arrays with less than 2 elements', () => {
      expect(service.calculateCovariance([1], [1])).toBe(0);
    });

    it('should calculate covariance correctly', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [2, 4, 6, 8, 10];
      const result = service.calculateCovariance(x, y);
      expect(result).toBeCloseTo(5, 1);
    });
  });

  describe('calculateCorrelation', () => {
    it('should return 0 for zero standard deviation', () => {
      expect(service.calculateCorrelation([1, 1, 1], [2, 3, 4])).toBe(0);
    });

    it('should calculate correlation correctly', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [2, 4, 6, 8, 10];
      const result = service.calculateCorrelation(x, y);
      expect(result).toBeCloseTo(1, 1);
    });
  });
});
