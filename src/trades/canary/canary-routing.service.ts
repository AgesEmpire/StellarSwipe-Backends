import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Optional } from '@nestjs/common';
import { CanaryRoutingConfig } from './canary-routing.entity';
import { createHash } from 'crypto';

export interface CanaryRoutingDecision {
  contractId: string;
  isCanary: boolean;
  canaryPercentage: number;
}

/**
 * Service for canary routing of trade execution traffic.
 *
 * Splits a configurable percentage of trade requests between the current
 * production contract and a canary contract version. Percentage is adjustable
 * at runtime via database updates without requiring redeploy.
 *
 * Routing decision is deterministic based on trade ID to ensure consistency:
 * the same trade always routes to the same contract version.
 */
@Injectable()
export class CanaryRoutingService {
  private readonly logger = new Logger(CanaryRoutingService.name);
  private readonly CONFIG_CACHE_KEY = 'canary_routing_config';
  private readonly CONFIG_CACHE_TTL = 60 * 1000; // 1 minute

  constructor(
    @InjectRepository(CanaryRoutingConfig)
    private readonly configRepo: Repository<CanaryRoutingConfig>,
    @Optional() @Inject(CACHE_MANAGER) private cacheManager?: Cache,
  ) {}

  /**
   * Decide which contract to route a trade to.
   *
   * Uses deterministic hashing based on trade ID so the same trade
   * always routes to the same contract, even across retries.
   *
   * @param tradeId - the trade's ID
   * @returns routing decision with contract ID and metrics
   */
  async routeTrade(tradeId: string): Promise<CanaryRoutingDecision> {
    const config = await this.getActiveConfig();

    if (!config) {
      this.logger.warn('No canary routing config found, using current contract');
      return {
        contractId: '',
        isCanary: false,
        canaryPercentage: 0,
      };
    }

    const isCanary = this.shouldRouteToCanary(tradeId, config.canaryPercentage);
    const contractId = isCanary ? config.canaryContractId : config.currentContractId;

    this.logger.debug(
      `Trade ${tradeId} routed to ${isCanary ? 'canary' : 'current'} contract (${config.canaryPercentage}% canary)`,
    );

    return {
      contractId,
      isCanary,
      canaryPercentage: config.canaryPercentage,
    };
  }

  /**
   * Update the canary traffic percentage at runtime.
   *
   * @param percentage - percentage of traffic (0-100) to send to canary
   * @param notes - optional notes about this change
   */
  async updateCanaryPercentage(percentage: number, notes?: string): Promise<CanaryRoutingConfig> {
    if (percentage < 0 || percentage > 100) {
      throw new Error('Canary percentage must be between 0 and 100');
    }

    const config = await this.getActiveConfig();

    if (!config) {
      throw new Error('No active canary routing config');
    }

    config.canaryPercentage = percentage;
    if (notes) {
      config.notes = notes;
    }

    const updated = await this.configRepo.save(config);

    // Invalidate cache
    if (this.cacheManager) {
      await this.cacheManager.del(this.CONFIG_CACHE_KEY);
    }

    this.logger.log(`Updated canary percentage to ${percentage}%: ${notes || 'no notes'}`);

    return updated;
  }

  /**
   * Get the current active canary routing configuration.
   *
   * Uses caching to avoid database hits on every trade.
   */
  private async getActiveConfig(): Promise<CanaryRoutingConfig | null> {
    // Try cache first
    if (this.cacheManager) {
      const cached = await this.cacheManager.get<CanaryRoutingConfig>(this.CONFIG_CACHE_KEY);
      if (cached) {
        return cached;
      }
    }

    // Fetch from database
    const config = await this.configRepo.findOne({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    if (config && this.cacheManager) {
      await this.cacheManager.set(this.CONFIG_CACHE_KEY, config, this.CONFIG_CACHE_TTL);
    }

    return config || null;
  }

  /**
   * Determine if a trade should route to canary based on percentage.
   *
   * Uses deterministic hashing of trade ID to ensure consistency.
   * For example, with 20% canary: any trade whose ID hash % 100 < 20 routes to canary.
   */
  private shouldRouteToCanary(tradeId: string, canaryPercentage: number): boolean {
    if (canaryPercentage <= 0) return false;
    if (canaryPercentage >= 100) return true;

    // Hash the trade ID to get a deterministic value
    const hash = createHash('sha256').update(tradeId).digest('hex');
    const hashValue = parseInt(hash.substring(0, 8), 16);
    const bucket = hashValue % 100;

    return bucket < canaryPercentage;
  }
}
