import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { ProviderStats } from '../../signals/entities/provider-stats.entity';
import { SorobanService } from '../../soroban/soroban.service';
import { SorobanMonitoringService } from '../../monitoring/alerts/soroban-monitoring.service';

export interface ProviderReputationSyncedEvent {
  providerId: string;
  oldScore: string;
  newScore: string;
}

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 200;
const FAILURE_ALERT_THRESHOLD = 3;
const REPUTATION_SYNC_EVENT = 'provider.reputation.synced';

@Injectable()
export class ReputationSyncJob {
  private readonly logger = new Logger(ReputationSyncJob.name);
  private readonly failuresByProvider = new Map<string, number>();

  constructor(
    @InjectRepository(ProviderStats)
    private readonly providerStatsRepository: Repository<ProviderStats>,
    private readonly sorobanService: SorobanService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly monitoringService?: SorobanMonitoringService,
  ) {}

  @Cron('*/5 * * * *', { name: 'provider-reputation-sync' })
  async syncProviderReputations(): Promise<void> {
    const providers = await this.providerStatsRepository.find({
      where: { activeSignals: MoreThan(0) },
      select: ['providerId', 'reputationScore'],
    });

    for (let index = 0; index < providers.length; index += BATCH_SIZE) {
      const batch = providers.slice(index, index + BATCH_SIZE);
      await Promise.all(batch.map((provider) => this.syncProvider(provider)));

      if (index + BATCH_SIZE < providers.length) {
        await this.delay(BATCH_DELAY_MS);
      }
    }
  }

  private async syncProvider(provider: ProviderStats): Promise<void> {
    const contractId = this.configService.get<string>('SIGNAL_REGISTRY_CONTRACT_ID');
    if (!contractId) {
      this.logger.warn('Skipping reputation sync: SIGNAL_REGISTRY_CONTRACT_ID is not configured');
      return;
    }

    try {
      const response = await this.sorobanService.invokeContract(
        contractId,
        'get_provider_reputation',
        [provider.providerId],
        {
          sourceSecret:
            this.configService.get<string>('SIGNAL_REGISTRY_SOURCE_SECRET') ??
            this.configService.get<string>('SOROBAN_SOURCE_SECRET'),
        },
      );
      const newScore = this.extractScore(response);
      const oldScore = provider.reputationScore;

      this.failuresByProvider.delete(provider.providerId);

      if (newScore === oldScore) return;

      await this.providerStatsRepository.update(provider.providerId, {
        reputationScore: newScore,
      });

      this.eventEmitter.emit(REPUTATION_SYNC_EVENT, {
        providerId: provider.providerId,
        oldScore,
        newScore,
      } satisfies ProviderReputationSyncedEvent);
    } catch (error) {
      this.recordFailure(provider.providerId, error);
    }
  }

  private extractScore(response: unknown): string {
    const result = (response as { result?: unknown })?.result ?? response;
    if (typeof result === 'number' || typeof result === 'bigint') {
      return String(result);
    }
    if (typeof result === 'string') {
      return result;
    }
    if (result && typeof result === 'object' && 'score' in result) {
      return String((result as { score: unknown }).score);
    }
    return '0';
  }

  private recordFailure(providerId: string, error: unknown): void {
    const count = (this.failuresByProvider.get(providerId) ?? 0) + 1;
    this.failuresByProvider.set(providerId, count);
    const message = error instanceof Error ? error.message : String(error);

    this.logger.warn(`Provider reputation sync failed for ${providerId}: ${message}`);

    if (count >= FAILURE_ALERT_THRESHOLD) {
      this.monitoringService?.recordFailure({
        contractId: this.configService.get<string>('SIGNAL_REGISTRY_CONTRACT_ID') ?? 'signal_registry',
        method: 'get_provider_reputation',
        error: message,
        timestamp: new Date(),
        userId: providerId,
      });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}