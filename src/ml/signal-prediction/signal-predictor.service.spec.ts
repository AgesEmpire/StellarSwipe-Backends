import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { NotFoundException } from '@nestjs/common';
import { SignalPredictorService } from './signal-predictor.service';
import { FeatureExtractorService } from './feature-extractor.service';
import { ModelTrainerService } from './model-trainer.service';
import { Signal, SignalStatus, SignalType, SignalOutcome } from '../../signals/entities/signal.entity';
import { Prediction } from './entities/prediction.entity';
import { ModelVersion } from './entities/model-version.entity';
import { PredictionConfidenceLevel } from './interfaces/prediction-metadata.interface';

const mockSignal = (): Partial<Signal> => ({
  id: 'signal-uuid-1',
  providerId: 'provider-uuid-1',
  baseAsset: 'XLM',
  counterAsset: 'USDC',
  type: SignalType.BUY,
  status: SignalStatus.ACTIVE,
  outcome: SignalOutcome.PENDING,
  entryPrice: '0.12',
  targetPrice: '0.14',
  stopLossPrice: '0.11',
  confidenceScore: 75,
  totalProfitLoss: '0',
  createdAt: new Date('2025-01-15T10:00:00Z'),
});

const mockPrediction = (): Partial<Prediction> => ({
  id: 'prediction-uuid-1',
  signalId: 'signal-uuid-1',
  providerId: 'provider-uuid-1',
  successProbability: 0.68,
  expectedPnlLow: 0.0092,
  expectedPnlMid: 0.0153,
  expectedPnlHigh: 0.023,
  confidenceScore: 0.72,
  confidenceLevel: PredictionConfidenceLevel.MEDIUM,
  featureVector: new Array(17).fill(0.5),
  modelContributions: [],
  createdAt: new Date(),
});

describe('SignalPredictorService', () => {
  let service: SignalPredictorService;

  const mockSignalRepo = {
    findOne: jest.fn(),
  };
  const mockPredictionRepo = {
    find: jest.fn(),
    save: jest.fn(),
  };
  const mockModelVersionRepo = {
    findOne: jest.fn(),
  };
  const mockFeatureExtractor = {
    extractAndVectorize: jest.fn(),
    extract: jest.fn(),
  };
  const mockModelTrainer = {
    getActiveEnsemble: jest.fn(),
    getActiveVersionId: jest.fn(),
    getSamplesCount: jest.fn(),
  };
  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalPredictorService,
        { provide: getRepositoryToken(Signal), useValue: mockSignalRepo },
        { provide: getRepositoryToken(Prediction), useValue: mockPredictionRepo },
        { provide: getRepositoryToken(ModelVersion), useValue: mockModelVersionRepo },
        { provide: FeatureExtractorService, useValue: mockFeatureExtractor },
        { provide: ModelTrainerService, useValue: mockModelTrainer },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    service = module.get<SignalPredictorService>(SignalPredictorService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('predict', () => {
    it('returns a cached result when available and forceRefresh is false', async () => {
      const cached = { ...mockPrediction(), fromCache: false };
      mockCacheManager.get.mockResolvedValue(cached);

      const result = await service.predict({ signalId: 'signal-uuid-1' });

      expect(result.fromCache).toBe(true);
      expect(mockSignalRepo.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when signal does not exist', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockSignalRepo.findOne.mockResolvedValue(null);

      await expect(service.predict({ signalId: 'non-existent' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('falls back to heuristic prediction when no trained model is available', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockSignalRepo.findOne.mockResolvedValue(mockSignal());
      mockFeatureExtractor.extractAndVectorize.mockResolvedValue(new Array(17).fill(0.5));
      mockFeatureExtractor.extract.mockResolvedValue({});
      mockModelTrainer.getActiveEnsemble.mockReturnValue(null);
      mockModelTrainer.getActiveVersionId.mockReturnValue(null);
      mockModelTrainer.getSamplesCount.mockResolvedValue(10);
      mockPredictionRepo.save.mockResolvedValue({ ...mockPrediction(), createdAt: new Date() });
      mockModelVersionRepo.findOne.mockResolvedValue(null);

      const result = await service.predict({ signalId: 'signal-uuid-1' });

      expect(result.modelVersion).toBe('heuristic');
      expect(result.warnings).toContain('Model not yet trained — prediction is heuristic only');
    });

    it('returns prediction with all required fields when model is trained', async () => {
      const mockEnsemble = {
        isReady: jest.fn().mockReturnValue(true),
        predict: jest.fn().mockResolvedValue({
          successProbability: 0.72,
          expectedPnL: 0.025,
          confidence: 0.78,
          featureImportance: { 'provider.winRate': 0.3, 'signal.confidenceScore': 0.2 },
        }),
        getContributions: jest.fn().mockResolvedValue([
          { modelType: 'GRADIENT_BOOSTING', weight: 0.6, successProbability: 0.74, expectedPnL: 0.026 },
          { modelType: 'NEURAL_NETWORK', weight: 0.4, successProbability: 0.69, expectedPnL: 0.023 },
        ]),
      };

      mockCacheManager.get.mockResolvedValue(null);
      mockSignalRepo.findOne.mockResolvedValue(mockSignal());
      mockFeatureExtractor.extractAndVectorize.mockResolvedValue(new Array(17).fill(0.5));
      mockFeatureExtractor.extract.mockResolvedValue({});
      mockModelTrainer.getActiveEnsemble.mockReturnValue(mockEnsemble);
      mockModelTrainer.getActiveVersionId.mockReturnValue('version-uuid-1');
      mockModelTrainer.getSamplesCount.mockResolvedValue(500);
      mockPredictionRepo.save.mockResolvedValue({ ...mockPrediction(), createdAt: new Date() });
      mockModelVersionRepo.findOne.mockResolvedValue({ version: 'v1234567890' });

      const result = await service.predict({
        signalId: 'signal-uuid-1',
        includeFeatureImportance: true,
      });

      expect(result.successProbability).toBe(72);
      expect(result.confidence).toBe(78);
      expect(result.modelContributions).toHaveLength(2);
      expect(result.topFeatures).toBeDefined();
      expect(result.fromCache).toBe(false);
    });

    it('forces cache refresh when forceRefresh is true', async () => {
      const mockEnsemble = {
        isReady: jest.fn().mockReturnValue(false),
        predict: jest.fn(),
        getContributions: jest.fn(),
      };

      mockCacheManager.get.mockResolvedValue({ successProbability: 50 }); // Should be ignored
      mockSignalRepo.findOne.mockResolvedValue(mockSignal());
      mockFeatureExtractor.extractAndVectorize.mockResolvedValue(new Array(17).fill(0.5));
      mockFeatureExtractor.extract.mockResolvedValue({});
      mockModelTrainer.getActiveEnsemble.mockReturnValue(null);
      mockModelTrainer.getActiveVersionId.mockReturnValue(null);
      mockModelTrainer.getSamplesCount.mockResolvedValue(20);
      mockPredictionRepo.save.mockResolvedValue({ ...mockPrediction(), createdAt: new Date() });
      mockModelVersionRepo.findOne.mockResolvedValue(null);

      await service.predict({ signalId: 'signal-uuid-1', forceRefresh: true });

      expect(mockSignalRepo.findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPredictionHistory', () => {
    it('returns all predictions for a signal ordered by date', async () => {
      const predictions = [mockPrediction(), mockPrediction()];
      mockPredictionRepo.find.mockResolvedValue(predictions);

      const result = await service.getPredictionHistory('signal-uuid-1');

      expect(result).toHaveLength(2);
      expect(mockPredictionRepo.find).toHaveBeenCalledWith({
        where: { signalId: 'signal-uuid-1' },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('invalidateCache', () => {
    it('deletes the cache entry for a signal', async () => {
      await service.invalidateCache('signal-uuid-1');
      expect(mockCacheManager.del).toHaveBeenCalledWith('signal-prediction:signal-uuid-1');
    });
  });
});
