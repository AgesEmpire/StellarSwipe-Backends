import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProviderIndexerService } from './provider-indexer.service';
import { ElasticsearchConfigService } from '../services/elasticsearch.service';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';
import { User } from '../../users/entities/user.entity';

describe('ProviderIndexerService', () => {
  let service: ProviderIndexerService;
  let elasticsearchService: { index: jest.Mock; update: jest.Mock; delete: jest.Mock; bulk: jest.Mock };
  let featureFlagsService: { isFlagEnabled: jest.Mock };
  let userRepository: any;

  const provider = {
    id: 'provider-1',
    username: 'trader1',
    displayName: 'Trader One',
    bio: 'Signals provider',
    reputationScore: 90,
    createdAt: new Date(),
  } as any;

  beforeEach(async () => {
    elasticsearchService = {
      index: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      bulk: jest.fn().mockResolvedValue({}),
    };
    featureFlagsService = { isFlagEnabled: jest.fn().mockResolvedValue(true) };
    userRepository = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderIndexerService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: ElasticsearchConfigService, useValue: elasticsearchService },
        { provide: FeatureFlagsService, useValue: featureFlagsService },
      ],
    }).compile();

    service = module.get<ProviderIndexerService>(ProviderIndexerService);
  });

  describe('when the search-index-refresh flag is enabled', () => {
    it('indexes the provider on provider.created', async () => {
      await service.handleProviderCreated(provider);
      expect(elasticsearchService.index).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'providers', id: 'provider-1' }),
      );
    });

    it('updates the index on provider.updated', async () => {
      await service.handleProviderUpdated(provider);
      expect(elasticsearchService.update).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'providers', id: 'provider-1' }),
      );
    });

    it('removes from the index on provider.deleted (e.g. suspension)', async () => {
      await service.handleProviderDeleted('provider-1');
      expect(elasticsearchService.delete).toHaveBeenCalledWith({ index: 'providers', id: 'provider-1' });
    });

    it('logs and swallows Elasticsearch failures instead of throwing', async () => {
      elasticsearchService.delete.mockRejectedValue(new Error('ES unavailable'));
      await expect(service.handleProviderDeleted('provider-1')).resolves.toBeUndefined();
    });
  });

  describe('when the search-index-refresh flag is disabled', () => {
    beforeEach(() => {
      featureFlagsService.isFlagEnabled.mockResolvedValue(false);
    });

    it('skips all index operations', async () => {
      await service.handleProviderCreated(provider);
      await service.handleProviderUpdated(provider);
      await service.handleProviderDeleted('provider-1');

      expect(elasticsearchService.index).not.toHaveBeenCalled();
      expect(elasticsearchService.update).not.toHaveBeenCalled();
      expect(elasticsearchService.delete).not.toHaveBeenCalled();
    });
  });
});
