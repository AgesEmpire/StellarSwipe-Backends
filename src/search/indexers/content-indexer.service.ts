import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProviderContent } from '../../content/entities/provider-content.entity';
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

  /**
   * Reindex every published content item, reporting a per-document outcome
   * rather than treating a partially failed bulk batch as fully
   * successful. Documents that failed in the initial bulk request are
   * retried individually once so they can be recovered selectively.
   */
  async reindexAll(): Promise<BulkIndexResult> {
    this.logger.log('Starting full content reindex...');

    const contents = await this.contentRepository.find({
      where: { published: true },
    });

    if (contents.length === 0) {
      return { total: 0, succeeded: [], failed: [] };
    }

    const providersById = await this.loadProvidersFor(contents);
    const ids = contents.map((content) => content.id);
    const bulkBody: unknown[] = [];
    for (const content of contents) {
      bulkBody.push({ index: { _index: this.indexName, _id: content.id } });
      bulkBody.push(this.mapContentToDocument(content, providersById.get(content.providerId) ?? null));
    }

    let result: BulkIndexResult;
    try {
      const response = await this.elasticsearchService.bulk({ body: bulkBody });
      result = parseBulkResponse(ids, response as any);
    } catch (error) {
      this.logger.error('Bulk content reindex request failed entirely', error as Error);
      result = failAllWithError(ids, error);
    }

    if (result.failed.length > 0) {
      this.logger.warn(
        `Content reindex: ${result.succeeded.length}/${result.total} succeeded in bulk; retrying ${result.failed.length} failed document(s) individually`,
      );
      result = await this.retryFailedContent(result, contents, providersById);
    }

    this.logger.log(
      `Reindexed ${result.succeeded.length}/${result.total} content items` +
        (result.failed.length > 0 ? ` (${result.failed.length} still failed)` : ''),
    );
    return result;
  }

  private async loadProvidersFor(contents: ProviderContent[]): Promise<Map<string, User>> {
    const providerIds = [...new Set(contents.map((content) => content.providerId))];
    if (providerIds.length === 0) {
      return new Map();
    }
    const providers = await this.userRepository.findBy({ id: In(providerIds) });
    return new Map(providers.map((provider) => [provider.id, provider]));
  }

  /**
   * Retry the documents that failed in the initial bulk request, indexing
   * each one individually so failures can be retried selectively instead
   * of re-running the entire batch.
   */
  private async retryFailedContent(
    result: BulkIndexResult,
    contents: ProviderContent[],
    providersById: Map<string, User>,
  ): Promise<BulkIndexResult> {
    const contentsById = new Map(contents.map((content) => [content.id, content]));
    const recovered: string[] = [];
    const stillFailed: BulkIndexResult['failed'] = [];

    for (const failure of result.failed) {
      const content = contentsById.get(failure.id);
      if (!content) {
        stillFailed.push(failure);
        continue;
      }

      try {
        await this.elasticsearchService.index({
          index: this.indexName,
          id: content.id,
          document: this.mapContentToDocument(content, providersById.get(content.providerId) ?? null),
        });
        recovered.push(content.id);
      } catch (error) {
        stillFailed.push({
          id: failure.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (stillFailed.length > 0) {
      this.logger.error(
        `Content reindex: ${stillFailed.length} document(s) could not be indexed after retry: ${stillFailed
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
