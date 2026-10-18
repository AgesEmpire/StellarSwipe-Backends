import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signal } from '../../signals/entities/signal.entity';
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
export class SignalIndexerService {
  private readonly logger = new Logger(SignalIndexerService.name);
  private readonly indexName = 'signals';

  constructor(
    @InjectRepository(Signal)
    private readonly signalRepository: Repository<Signal>,
    private readonly elasticsearchService: ElasticsearchConfigService,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  @OnEvent('signal.created')
  async handleSignalCreated(signal: Signal) {
    if (!(await this.isRefreshEnabled())) return;
    await this.indexSignal(signal);
  }

  @OnEvent('signal.updated')
  async handleSignalUpdated(signal: Signal) {
    if (!(await this.isRefreshEnabled())) return;
    await this.updateSignalIndex(signal);
  }

  @OnEvent('signal.deleted')
  async handleSignalDeleted(signalId: string) {
    if (!(await this.isRefreshEnabled())) return;
    await this.deleteSignalIndex(signalId);
  }

  private async isRefreshEnabled(): Promise<boolean> {
    const enabled = await this.featureFlagsService.isFlagEnabled(SEARCH_INDEX_REFRESH_FLAG);
    if (!enabled) {
      this.logger.debug(`Search index refresh skipped — '${SEARCH_INDEX_REFRESH_FLAG}' flag is disabled`);
    }
    return enabled;
  }

  async indexSignal(signal: Signal): Promise<void> {
    try {
      await this.elasticsearchService.index({
        index: this.indexName,
        id: signal.id,
        document: this.mapSignalToDocument(signal),
      });
      this.logger.log(`Indexed signal: ${signal.id}`);
    } catch (error) {
      this.logger.error(`Failed to index signal ${signal.id}`, error);
    }
  }

  async updateSignalIndex(signal: Signal): Promise<void> {
    try {
      await this.elasticsearchService.update({
        index: this.indexName,
        id: signal.id,
        doc: this.mapSignalToDocument(signal),
      });
      this.logger.log(`Updated signal index: ${signal.id}`);
    } catch (error) {
      this.logger.error(`Failed to update signal index ${signal.id}`, error);
    }
  }

  async deleteSignalIndex(signalId: string): Promise<void> {
    try {
      await this.elasticsearchService.delete({
        index: this.indexName,
        id: signalId,
      });
      this.logger.log(`Deleted signal from index: ${signalId}`);
    } catch (error) {
      this.logger.error(`Failed to delete signal ${signalId}`, error);
    }
  }

  /**
   * Reindex every signal, reporting a per-document outcome rather than
   * treating a partially failed bulk batch as fully successful. Documents
   * that failed in the initial bulk request are retried individually once
   * so a single transient/malformed document does not drop the rest of
   * the batch.
   */
  async reindexAll(): Promise<BulkIndexResult> {
    this.logger.log('Starting full signal reindex...');

    const signals = await this.signalRepository.find({
      relations: ['provider'],
    });

    if (signals.length === 0) {
      return { total: 0, succeeded: [], failed: [] };
    }

    const ids = signals.map((signal) => signal.id);
    const bulkBody: unknown[] = [];
    for (const signal of signals) {
      bulkBody.push({ index: { _index: this.indexName, _id: signal.id } });
      bulkBody.push(this.mapSignalToDocument(signal));
    }

    let result: BulkIndexResult;
    try {
      const response = await this.elasticsearchService.bulk({ body: bulkBody });
      result = parseBulkResponse(ids, response as any);
    } catch (error) {
      this.logger.error('Bulk signal reindex request failed entirely', error as Error);
      result = failAllWithError(ids, error);
    }

    if (result.failed.length > 0) {
      this.logger.warn(
        `Signal reindex: ${result.succeeded.length}/${result.total} succeeded in bulk; retrying ${result.failed.length} failed document(s) individually`,
      );
      result = await this.retryFailedSignals(result, signals);
    }

    this.logger.log(
      `Reindexed ${result.succeeded.length}/${result.total} signals` +
        (result.failed.length > 0 ? ` (${result.failed.length} still failed)` : ''),
    );
    return result;
  }

  /**
   * Retry the documents that failed in the initial bulk request, indexing
   * each one individually so failures can be retried selectively instead
   * of re-running the entire batch.
   */
  private async retryFailedSignals(
    result: BulkIndexResult,
    signals: Signal[],
  ): Promise<BulkIndexResult> {
    const signalsById = new Map(signals.map((signal) => [signal.id, signal]));
    const recovered: string[] = [];
    const stillFailed: BulkIndexResult['failed'] = [];

    for (const failure of result.failed) {
      const signal = signalsById.get(failure.id);
      if (!signal) {
        stillFailed.push(failure);
        continue;
      }

      try {
        await this.elasticsearchService.index({
          index: this.indexName,
          id: signal.id,
          document: this.mapSignalToDocument(signal),
        });
        recovered.push(signal.id);
      } catch (error) {
        stillFailed.push({
          id: failure.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (stillFailed.length > 0) {
      this.logger.error(
        `Signal reindex: ${stillFailed.length} document(s) could not be indexed after retry: ${stillFailed
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

  private mapSignalToDocument(signal: Signal): any {
    const assetPair = signal.getAssetPair();
    return {
      id: signal.id,
      assetPair,
      baseAsset: signal.baseAsset,
      counterAsset: signal.counterAsset,
      action: signal.type,
      rationale: signal.rationale,
      providerId: signal.providerId,
      providerName: signal.provider?.displayName || signal.provider?.username,
      entryPrice: parseFloat(signal.entryPrice),
      targetPrice: parseFloat(signal.targetPrice),
      stopLossPrice: signal.stopLossPrice
        ? parseFloat(signal.stopLossPrice)
        : null,
      currentPrice: signal.currentPrice ? parseFloat(signal.currentPrice) : null,
      createdAt: signal.createdAt,
      closedAt: signal.closedAt,
      status: signal.status,
      outcome: signal.outcome,
      winRate: signal.successRate,
      successRate: signal.successRate,
      confidenceScore: signal.confidenceScore,
      suggest: {
        input: [
          assetPair,
          signal.rationale || '',
          signal.provider?.displayName || signal.provider?.username || '',
        ].filter(Boolean),
      },
    };
  }
}
