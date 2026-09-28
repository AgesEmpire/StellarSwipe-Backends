import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SignalIndexerService } from './signal-indexer.service';
import { ElasticsearchConfigService } from '../services/elasticsearch.service';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';
import { Signal } from '../../signals/entities/signal.entity';

describe('SignalIndexerService', () => {
  let service: SignalIndexerService;
  let elasticsearchService: { index: jest.Mock; update: jest.Mock; delete: jest.Mock; bulk: jest.Mock };
  let featureFlagsService: { isFlagEnabled: jest.Mock };
  let signalRepository: any;

  const signal = {
    id: 'signal-1',
    baseAsset: 'XLM',
    counterAsset: 'USDC',
    getAssetPair: () => 'XLM/USDC',
    type: 'buy',
    rationale: 'test',
    providerId: 'provider-1',
    provider: { displayName: 'Provider One' },
    entryPrice: '1.0',
    targetPrice: '1.1',
    stopLossPrice: null,
    currentPrice: null,
    createdAt: new Date(),
    closedAt: null,
    status: 'active',
    outcome: null,
    successRate: 0,
    confidenceScore: 50,
  } as any;

  beforeEach(async () => {
    elasticsearchService = {
      index: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      bulk: jest.fn().mockResolvedValue({}),
    };
    featureFlagsService = { isFlagEnabled: jest.fn().mockResolvedValue(true) };
    signalRepository = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalIndexerService,
        { provide: getRepositoryToken(Signal), useValue: signalRepository },
        { provide: ElasticsearchConfigService, useValue: elasticsearchService },
        { provide: FeatureFlagsService, useValue: featureFlagsService },
      ],
    }).compile();

    service = module.get<SignalIndexerService>(SignalIndexerService);
  });

  describe('when the search-index-refresh flag is enabled', () => {
    it('indexes the signal on signal.created', async () => {
      await service.handleSignalCreated(signal);
      expect(featureFlagsService.isFlagEnabled).toHaveBeenCalledWith('search-index-refresh');
      expect(elasticsearchService.index).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'signals', id: 'signal-1' }),
      );
    });

    it('updates the index on signal.updated', async () => {
      await service.handleSignalUpdated(signal);
      expect(elasticsearchService.update).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'signals', id: 'signal-1' }),
      );
    });

    it('removes from the index on signal.deleted', async () => {
      await service.handleSignalDeleted('signal-1');
      expect(elasticsearchService.delete).toHaveBeenCalledWith({ index: 'signals', id: 'signal-1' });
    });

    it('logs and swallows Elasticsearch failures instead of throwing', async () => {
      elasticsearchService.index.mockRejectedValue(new Error('ES unavailable'));
      await expect(service.handleSignalCreated(signal)).resolves.toBeUndefined();
    });
  });

  describe('when the search-index-refresh flag is disabled', () => {
    beforeEach(() => {
      featureFlagsService.isFlagEnabled.mockResolvedValue(false);
    });

    it('skips indexing on signal.created', async () => {
      await service.handleSignalCreated(signal);
      expect(elasticsearchService.index).not.toHaveBeenCalled();
    });

    it('skips updating on signal.updated', async () => {
      await service.handleSignalUpdated(signal);
      expect(elasticsearchService.update).not.toHaveBeenCalled();
    });

    it('skips deleting on signal.deleted', async () => {
      await service.handleSignalDeleted('signal-1');
      expect(elasticsearchService.delete).not.toHaveBeenCalled();
    });
  });
});
