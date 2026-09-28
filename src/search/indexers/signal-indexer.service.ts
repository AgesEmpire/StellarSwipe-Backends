import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signal } from '../../signals/entities/signal.entity';
import { ElasticsearchConfigService } from '../services/elasticsearch.service';
import { OnEvent } from '@nestjs/event-emitter';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';

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

  async reindexAll(): Promise<void> {
    this.logger.log('Starting full signal reindex...');
    try {
      const signals = await this.signalRepository.find({
        relations: ['provider'],
      });

      const bulkBody = [];
      for (const signal of signals) {
        bulkBody.push({ index: { _index: this.indexName, _id: signal.id } });
        bulkBody.push(this.mapSignalToDocument(signal));
      }

      if (bulkBody.length > 0) {
        await this.elasticsearchService.bulk({ body: bulkBody });
        this.logger.log(`Reindexed ${signals.length} signals`);
      }
    } catch (error) {
      this.logger.error('Failed to reindex signals', error);
    }
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
