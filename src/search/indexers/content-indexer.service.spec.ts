import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ContentIndexerService } from './content-indexer.service';
import { ElasticsearchConfigService } from '../services/elasticsearch.service';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';
import { ProviderContent } from '../../content/entities/provider-content.entity';
import { User } from '../../users/entities/user.entity';

describe('ContentIndexerService', () => {
  let service: ContentIndexerService;
  let elasticsearchService: { index: jest.Mock; update: jest.Mock; delete: jest.Mock; bulk: jest.Mock };
  let featureFlagsService: { isFlagEnabled: jest.Mock };
  let contentRepository: any;
  let userRepository: any;

  const content = {
    id: 'content-1',
    providerId: 'provider-1',
    type: 'article',
    title: 'How to trade',
    body: 'Some body text',
    tags: ['xlm'],
    status: 'published',
    views: 0,
    likes: 0,
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
    contentRepository = { find: jest.fn() };
    userRepository = { findOne: jest.fn().mockResolvedValue({ displayName: 'Provider One' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentIndexerService,
        { provide: getRepositoryToken(ProviderContent), useValue: contentRepository },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: ElasticsearchConfigService, useValue: elasticsearchService },
        { provide: FeatureFlagsService, useValue: featureFlagsService },
      ],
    }).compile();

    service = module.get<ContentIndexerService>(ContentIndexerService);
  });

  describe('when the search-index-refresh flag is enabled', () => {
    it('indexes the content on content.created', async () => {
      await service.handleContentCreated(content);
      expect(elasticsearchService.index).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'content', id: 'content-1' }),
      );
    });

    it('updates the index on content.updated', async () => {
      await service.handleContentUpdated(content);
      expect(elasticsearchService.update).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'content', id: 'content-1' }),
      );
    });

    it('removes from the index on content.deleted (e.g. unpublish/delete)', async () => {
      await service.handleContentDeleted('content-1');
      expect(elasticsearchService.delete).toHaveBeenCalledWith({ index: 'content', id: 'content-1' });
    });

    it('logs and swallows Elasticsearch failures instead of throwing', async () => {
      elasticsearchService.index.mockRejectedValue(new Error('ES unavailable'));
      await expect(service.handleContentCreated(content)).resolves.toBeUndefined();
    });
  });

  describe('when the search-index-refresh flag is disabled', () => {
    beforeEach(() => {
      featureFlagsService.isFlagEnabled.mockResolvedValue(false);
    });

    it('skips all index operations', async () => {
      await service.handleContentCreated(content);
      await service.handleContentUpdated(content);
      await service.handleContentDeleted('content-1');

      expect(elasticsearchService.index).not.toHaveBeenCalled();
      expect(elasticsearchService.update).not.toHaveBeenCalled();
      expect(elasticsearchService.delete).not.toHaveBeenCalled();
    });
  });
});
