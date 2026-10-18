import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ElasticsearchConfigService } from '../services/elasticsearch.service';
import { OnEvent } from '@nestjs/event-emitter';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';
import {
  BulkIndexResult,
  failAllWithError,
  parseBulkResponse,
} from '../utils/bulk-index-result.util';

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

  /**
   * Reindex every active provider, reporting a per-document outcome rather
   * than treating a partially failed bulk batch as fully successful.
   * Documents that failed in the initial bulk request are retried
   * individually once so they can be recovered selectively.
   */
  async reindexAll(): Promise<BulkIndexResult> {
    this.logger.log('Starting full provider reindex...');

    const providers = await this.userRepository.find({
      where: { isActive: true },
    });

    if (providers.length === 0) {
      return { total: 0, succeeded: [], failed: [] };
    }

    const ids = providers.map((provider) => provider.id);
    const bulkBody: unknown[] = [];
    for (const provider of providers) {
      bulkBody.push({ index: { _index: this.indexName, _id: provider.id } });
      bulkBody.push(this.mapProviderToDocument(provider));
    }

    let result: BulkIndexResult;
    try {
      const response = await this.elasticsearchService.bulk({ body: bulkBody });
      result = parseBulkResponse(ids, response as any);
    } catch (error) {
      this.logger.error('Bulk provider reindex request failed entirely', error as Error);
      result = failAllWithError(ids, error);
    }

    if (result.failed.length > 0) {
      this.logger.warn(
        `Provider reindex: ${result.succeeded.length}/${result.total} succeeded in bulk; retrying ${result.failed.length} failed document(s) individually`,
      );
      result = await this.retryFailedProviders(result, providers);
    }

    this.logger.log(
      `Reindexed ${result.succeeded.length}/${result.total} providers` +
        (result.failed.length > 0 ? ` (${result.failed.length} still failed)` : ''),
    );
    return result;
  }

  /**
   * Retry the documents that failed in the initial bulk request, indexing
   * each one individually so failures can be retried selectively instead
   * of re-running the entire batch.
   */
  private async retryFailedProviders(
    result: BulkIndexResult,
    providers: User[],
  ): Promise<BulkIndexResult> {
    const providersById = new Map(providers.map((provider) => [provider.id, provider]));
    const recovered: string[] = [];
    const stillFailed: BulkIndexResult['failed'] = [];

    for (const failure of result.failed) {
      const provider = providersById.get(failure.id);
      if (!provider) {
        stillFailed.push(failure);
        continue;
      }

      try {
        await this.elasticsearchService.index({
          index: this.indexName,
          id: provider.id,
          document: this.mapProviderToDocument(provider),
        });
        recovered.push(provider.id);
      } catch (error) {
        stillFailed.push({
          id: failure.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (stillFailed.length > 0) {
      this.logger.error(
        `Provider reindex: ${stillFailed.length} document(s) could not be indexed after retry: ${stillFailed
          .map((f) => f.id)
          .join(', ')}`,
      );
    }

    return {
      total: result.total,
      succeeded: [...result.succeeded, ...recovered],
      failed: stillFailed,
    };
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
