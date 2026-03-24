import { Injectable, Logger } from '@nestjs/common';
import { DexAdapter, DexQuote } from '../interfaces/dex-adapter.interface';
import { QuoteRequest } from '../interfaces/quote-request.interface';
import { PriceComparator, PriceComparison } from '../utils/price-comparator';
import { AggregatedQuoteDto } from '../dto/aggregated-quote.dto';

export interface AggregationResult {
  quotes: DexQuote[];
  failedDexes: FailedDex[];
  aggregationTimeMs: number;
}

interface FailedDex {
  dexId: string;
  dexName: string;
  error: string;
}

@Injectable()
export class QuoteAggregatorService {
  private readonly logger = new Logger(QuoteAggregatorService.name);

  /**
   * Fetch quotes from all registered adapters in parallel with timeout protection
   */
  async aggregateQuotes(
    adapters: DexAdapter[],
    request: QuoteRequest,
    timeoutMs = 5000,
  ): Promise<AggregationResult> {
    const startTime = Date.now();
    const failedDexes: FailedDex[] = [];

    const quotePromises = adapters
      .filter((a) => !request.excludeDexes?.includes(a.dexId))
      .map((adapter) =>
        this.fetchWithTimeout(adapter, request, timeoutMs).catch((err) => {
          this.logger.warn(
            `[${adapter.dexName}] Quote fetch failed: ${err.message}`,
          );
          failedDexes.push({
            dexId: adapter.dexId,
            dexName: adapter.dexName,
            error: err.message,
          });
          return null;
        }),
      );

    const results = await Promise.allSettled(quotePromises);
    const quotes = results
      .filter(
        (r): r is PromiseFulfilledResult<DexQuote> =>
          r.status === 'fulfilled' && r.value !== null,
      )
      .map((r) => r.value);

    return {
      quotes,
      failedDexes,
      aggregationTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Aggregate and compare quotes, returning a structured DTO
   */
  async getAggregatedQuoteDto(
    adapters: DexAdapter[],
    request: QuoteRequest,
  ): Promise<AggregatedQuoteDto> {
    const { quotes, aggregationTimeMs } = await this.aggregateQuotes(
      adapters,
      request,
    );

    if (!quotes.length) {
      throw new Error('No quotes returned from any DEX');
    }

    const comparison: PriceComparison = PriceComparator.compare(quotes);

    return {
      bestQuote: comparison.bestQuote,
      allQuotes: comparison.rankedQuotes,
      dexesQueried: adapters.length,
      dexesResponded: quotes.length,
      aggregationTimeMs,
      timestamp: new Date(),
    };
  }

  /**
   * Check health of all registered adapters
   */
  async checkHealth(
    adapters: DexAdapter[],
  ): Promise<Record<string, boolean>> {
    const results = await Promise.allSettled(
      adapters.map(async (a) => ({ id: a.dexId, healthy: await a.isHealthy() })),
    );

    return results.reduce((acc, r) => {
      if (r.status === 'fulfilled') {
        acc[r.value.id] = r.value.healthy;
      }
      return acc;
    }, {} as Record<string, boolean>);
  }

  private async fetchWithTimeout(
    adapter: DexAdapter,
    request: QuoteRequest,
    timeoutMs: number,
  ): Promise<DexQuote> {
    return Promise.race([
      adapter.getQuote(request),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }
}
