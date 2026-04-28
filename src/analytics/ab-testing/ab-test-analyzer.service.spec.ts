import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AbTestAnalyzerService } from './ab-test-analyzer.service';
import { ExperimentResult } from './entities/experiment-result.entity';
import { VariantPerformance } from './entities/variant-performance.entity';

const mockRepo = () => ({ findOne: jest.fn(), save: jest.fn(), create: jest.fn((x) => x) });

const baseDto = {
  experimentId: 'exp-1',
  name: 'Button Color Test',
  confidenceLevel: 0.95,
  variants: [
    { variantId: 'control', name: 'Control', impressions: 1000, conversions: 100 },
    { variantId: 'variant-a', name: 'Variant A', impressions: 1000, conversions: 150 },
  ],
};

describe('AbTestAnalyzerService', () => {
  let service: AbTestAnalyzerService;
  let experimentRepo: ReturnType<typeof mockRepo>;
  let variantRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    experimentRepo = mockRepo();
    variantRepo = mockRepo();

    const module = await Test.createTestingModule({
      providers: [
        AbTestAnalyzerService,
        { provide: getRepositoryToken(ExperimentResult), useValue: experimentRepo },
        { provide: getRepositoryToken(VariantPerformance), useValue: variantRepo },
      ],
    }).compile();

    service = module.get(AbTestAnalyzerService);
  });

  it('returns significant result for large conversion difference', async () => {
    const result = await service.analyze(baseDto);
    expect(result.experimentId).toBe('exp-1');
    expect(result.tests.length).toBeGreaterThan(0);
    expect(result.recommendation.isSignificant).toBe(true);
    expect(result.recommendation.action).toBe('adopt');
    expect(result.recommendation.uplift).toBeCloseTo(0.5, 1);
  });

  it('returns continue for no meaningful difference', async () => {
    const result = await service.analyze({
      ...baseDto,
      variants: [
        { variantId: 'control', name: 'Control', impressions: 100, conversions: 10 },
        { variantId: 'variant-a', name: 'Variant A', impressions: 100, conversions: 11 },
      ],
    });
    expect(result.recommendation.action).toBe('continue');
  });

  it('includes t-test when mean/stdDev provided', async () => {
    const result = await service.analyze({
      ...baseDto,
      variants: [
        { variantId: 'control', name: 'Control', impressions: 500, conversions: 50, mean: 10, stdDev: 2 },
        { variantId: 'variant-a', name: 'Variant A', impressions: 500, conversions: 80, mean: 12, stdDev: 2 },
      ],
    });
    expect(result.tests.some((t) => t.testType === 't-test')).toBe(true);
  });

  it('getResult delegates to repository', async () => {
    const mock = { experimentId: 'exp-1' };
    experimentRepo.findOne.mockResolvedValue(mock);
    const result = await service.getResult('exp-1');
    expect(result).toEqual(mock);
  });
});
