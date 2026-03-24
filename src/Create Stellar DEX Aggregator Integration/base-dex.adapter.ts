import { Logger } from '@nestjs/common';
import {
  DexAdapter,
  AssetPair,
  DexQuote,
  LiquidityPoolInfo,
  OrderBook,
  StellarAsset,
} from '../interfaces/dex-adapter.interface';
import { QuoteRequest } from '../interfaces/quote-request.interface';

export abstract class BaseDexAdapter implements DexAdapter {
  protected readonly logger: Logger;
  abstract readonly dexName: string;
  abstract readonly dexId: string;

  constructor() {
    this.logger = new Logger(this.constructor.name);
  }

  abstract getQuote(request: QuoteRequest): Promise<DexQuote>;
  abstract getLiquidityPools(assetPair: AssetPair): Promise<LiquidityPoolInfo[]>;
  abstract getOrderBook(assetPair: AssetPair): Promise<OrderBook>;
  abstract isHealthy(): Promise<boolean>;

  protected formatAsset(asset: StellarAsset): string {
    if (asset.type === 'native') return 'native';
    return `${asset.code}:${asset.issuer}`;
  }

  protected parseAssetString(assetStr: string): StellarAsset {
    if (assetStr === 'native' || assetStr === 'XLM') {
      return { code: 'XLM', type: 'native' };
    }
    const [code, issuer] = assetStr.split(':');
    return {
      code,
      issuer,
      type: code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12',
    };
  }

  protected calculateSlippage(
    requestedAmount: string,
    executedAmount: string,
  ): number {
    const requested = parseFloat(requestedAmount);
    const executed = parseFloat(executedAmount);
    if (requested === 0) return 0;
    return Math.abs((requested - executed) / requested) * 100;
  }

  protected buildQuoteExpiry(ttlSeconds = 30): Date {
    return new Date(Date.now() + ttlSeconds * 1000);
  }

  protected async withRetry<T>(
    fn: () => Promise<T>,
    retries = 3,
    delayMs = 1000,
  ): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === retries) throw error;
        this.logger.warn(
          `Attempt ${attempt} failed for ${this.dexName}: ${error.message}. Retrying...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
}
