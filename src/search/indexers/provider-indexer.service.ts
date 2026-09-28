import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ElasticsearchConfigService } from '../services/elasticsearch.service';
import { OnEvent } from '@nestjs/event-emitter';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';

const SEARCH_INDEX_REFRESH_FLAG = 'search-index-refresh';

@Injectable()
export class ProviderIndexerService {
  private readonly logger = new Logger(ProviderIndexerService.name);
  private readonly indexName = 'providers';

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly elasticsearchService: ElasticsearchConfigService,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  @OnEvent('provider.created')
  async handleProviderCreated(provider: User) {
    if (!(await this.isRefreshEnabled())) return;
    await this.indexProvider(provider);
  }

  @OnEvent('provider.updated')
  async handleProviderUpdated(provider: User) {
    if (!(await this.isRefreshEnabled())) return;
    await this.updateProviderIndex(provider);
  }

  @OnEvent('provider.deleted')
  async handleProviderDeleted(providerId: string) {
    if (!(await this.isRefreshEnabled())) return;
    await this.deleteProviderIndex(providerId);
  }

  private async isRefreshEnabled(): Promise<boolean> {
    const enabled = await this.featureFlagsService.isFlagEnabled(SEARCH_INDEX_REFRESH_FLAG);
    if (!enabled) {
      this.logger.debug(`Search index refresh skipped — '${SEARCH_INDEX_REFRESH_FLAG}' flag is disabled`);
    }
    return enabled;
  }

  async indexProvider(provider: User): Promise<void> {
    try {
      await this.elasticsearchService.index({
        index: this.indexName,
        id: provider.id,
        document: this.mapProviderToDocument(provider),
      });
      this.logger.log(`Indexed provider: ${provider.id}`);
    } catch (error) {
      this.logger.error(`Failed to index provider ${provider.id}`, error);
    }
  }

  async updateProviderIndex(provider: User): Promise<void> {
    try {
      await this.elasticsearchService.update({
        index: this.indexName,
        id: provider.id,
        doc: this.mapProviderToDocument(provider),
      });
      this.logger.log(`Updated provider index: ${provider.id}`);
    } catch (error) {
      this.logger.error(`Failed to update provider index ${provider.id}`, error);
    }
  }

  async deleteProviderIndex(providerId: string): Promise<void> {
    try {
      await this.elasticsearchService.delete({
        index: this.indexName,
        id: providerId,
      });
      this.logger.log(`Deleted provider from index: ${providerId}`);
    } catch (error) {
      this.logger.error(`Failed to delete provider ${providerId}`, error);
    }
  }

  async reindexAll(): Promise<void> {
    this.logger.log('Starting full provider reindex...');
    try {
      const providers = await this.userRepository.find({
        where: { isActive: true },
      });

      const bulkBody = [];
      for (const provider of providers) {
        bulkBody.push({ index: { _index: this.indexName, _id: provider.id } });
        bulkBody.push(this.mapProviderToDocument(provider));
      }

      if (bulkBody.length > 0) {
        await this.elasticsearchService.bulk({ body: bulkBody });
        this.logger.log(`Reindexed ${providers.length} providers`);
      }
    } catch (error) {
      this.logger.error('Failed to reindex providers', error);
    }
  }

  private mapProviderToDocument(provider: User): any {
    return {
      id: provider.id,
      username: provider.username,
      displayName: provider.displayName,
      bio: provider.bio,
      reputationScore: provider.reputationScore,
      createdAt: provider.createdAt,
      suggest: {
        input: [
          provider.username,
          provider.displayName,
          provider.bio || '',
        ].filter(Boolean),
      },
    };
  }
}
