import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { FallbackConfigDto, PricingSourceResultDto } from './dto/fallback-config.dto';
import { buildSourceList, selectBestSource } from './utils/source-selector';

@Injectable()
export class PricingFallbackService {
  private readonly logger = new Logger(PricingFallbackService.name);
  private readonly sourceAvailability = new Map<string, boolean>();

  async getPriceWithFallback(
    assetPair: string,
    config: FallbackConfigDto,
  ): Promise<PricingSourceResultDto> {
    const sources = buildSourceList(config.primarySource, config.fallbackSources);

    for (const [name, available] of this.sourceAvailability.entries()) {
      const source = sources.find((s) => s.name === name);
      if (source) source.isAvailable = available;
    }

    const selected = selectBestSource(sources);
    if (!selected) {
      throw new ServiceUnavailableException('All pricing sources are unavailable');
    }

    const isFallback = selected.name !== config.primarySource;
    if (isFallback) {
      this.logger.warn(`Using fallback pricing source '${selected.name}' for ${assetPair}`);
    }

    const price = await this.fetchPrice(assetPair, selected.name, config.timeoutMs ?? 5000);

    return {
      source: selected.name,
      price,
      timestamp: new Date(),
      isFallback,
    };
  }

  markSourceUnavailable(sourceName: string): void {
    this.sourceAvailability.set(sourceName, false);
    this.logger.warn(`Pricing source '${sourceName}' marked as unavailable`);
  }

  markSourceAvailable(sourceName: string): void {
    this.sourceAvailability.set(sourceName, true);
    this.logger.log(`Pricing source '${sourceName}' restored`);
  }

  private async fetchPrice(assetPair: string, source: string, timeoutMs: number): Promise<number> {
    // Stub: in production, this would call the actual source API with a timeout
    this.logger.debug(`Fetching price for ${assetPair} from ${source} (timeout: ${timeoutMs}ms)`);
    return 0;
  }
}
