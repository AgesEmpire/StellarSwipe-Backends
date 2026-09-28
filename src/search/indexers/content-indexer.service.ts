import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProviderContent } from '../../content/entities/provider-content.entity';
import { User } from '../../users/entities/user.entity';
import { ElasticsearchConfigService } from '../services/elasticsearch.service';
import { OnEvent } from '@nestjs/event-emitter';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';

const SEARCH_INDEX_REFRESH_FLAG = 'search-index-refresh';

@Injectable()
export class ContentIndexerService {
  private readonly logger = new Logger(ContentIndexerService.name);
  private readonly indexName = 'content';

  constructor(
    @InjectRepository(ProviderContent)
    private readonly contentRepository: Repository<ProviderContent>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly elasticsearchService: ElasticsearchConfigService,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  @OnEvent('content.created')
  async handleContentCreated(content: ProviderContent) {
    if (!(await this.isRefreshEnabled())) return;
    await this.indexContent(content);
  }

  @OnEvent('content.updated')
  async handleContentUpdated(content: ProviderContent) {
    if (!(await this.isRefreshEnabled())) return;
    await this.updateContentIndex(content);
  }

  @OnEvent('content.deleted')
  async handleContentDeleted(contentId: string) {
    if (!(await this.isRefreshEnabled())) return;
    await this.deleteContentIndex(contentId);
  }

  private async isRefreshEnabled(): Promise<boolean> {
    const enabled = await this.featureFlagsService.isFlagEnabled(SEARCH_INDEX_REFRESH_FLAG);
    if (!enabled) {
      this.logger.debug(`Search index refresh skipped — '${SEARCH_INDEX_REFRESH_FLAG}' flag is disabled`);
    }
    return enabled;
  }

  async indexContent(content: ProviderContent): Promise<void> {
    try {
      const provider = await this.userRepository.findOne({
        where: { id: content.providerId },
      });

      await this.elasticsearchService.index({
        index: this.indexName,
        id: content.id,
        document: this.mapContentToDocument(content, provider),
      });
      this.logger.log(`Indexed content: ${content.id}`);
    } catch (error) {
      this.logger.error(`Failed to index content ${content.id}`, error);
    }
  }

  async updateContentIndex(content: ProviderContent): Promise<void> {
    try {
      const provider = await this.userRepository.findOne({
        where: { id: content.providerId },
      });

      await this.elasticsearchService.update({
        index: this.indexName,
        id: content.id,
        doc: this.mapContentToDocument(content, provider),
      });
      this.logger.log(`Updated content index: ${content.id}`);
    } catch (error) {
      this.logger.error(`Failed to update content index ${content.id}`, error);
    }
  }

  async deleteContentIndex(contentId: string): Promise<void> {
    try {
      await this.elasticsearchService.delete({
        index: this.indexName,
        id: contentId,
      });
      this.logger.log(`Deleted content from index: ${contentId}`);
    } catch (error) {
      this.logger.error(`Failed to delete content ${contentId}`, error);
    }
  }

  async reindexAll(): Promise<void> {
    this.logger.log('Starting full content reindex...');
    try {
      const contents = await this.contentRepository.find({
        where: { published: true },
      });

      const bulkBody = [];
      for (const content of contents) {
        const provider = await this.userRepository.findOne({
          where: { id: content.providerId },
        });
        bulkBody.push({ index: { _index: this.indexName, _id: content.id } });
        bulkBody.push(this.mapContentToDocument(content, provider));
      }

      if (bulkBody.length > 0) {
        await this.elasticsearchService.bulk({ body: bulkBody });
        this.logger.log(`Reindexed ${contents.length} content items`);
      }
    } catch (error) {
      this.logger.error('Failed to reindex content', error);
    }
  }

  private mapContentToDocument(
    content: ProviderContent,
    provider: User | null,
  ): any {
    return {
      id: content.id,
      providerId: content.providerId,
      providerName: provider?.displayName || provider?.username,
      type: content.type,
      title: content.title,
      body: content.body,
      tags: content.tags,
      status: content.status,
      views: content.views,
      likes: content.likes,
      createdAt: content.createdAt,
      suggest: {
        input: [content.title, ...content.tags].filter(Boolean),
      },
    };
  }
}
