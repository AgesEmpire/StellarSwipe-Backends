import { Injectable, Logger } from '@nestjs/common';
import { PriceSourceResult } from '../dto/price-data.dto';
import { HttpRetryService } from '../../http/http-retry.service';
import { CircuitBreakerService } from '../../http/circuit-breaker.service';

const REQUEST_TIMEOUT_MS = 5000;

@Injectable()
export class CoinGeckoPriceProvider {
  private readonly logger = new Logger(CoinGeckoPriceProvider.name);
  private readonly baseUrl = 'https://api.coingecko.com/api/v3';
  private static readonly CIRCUIT_NAME = 'coingecko-price';

  private readonly assetMapping = {
    XLM: 'stellar',
    USDC: 'usd-coin',
    BTC: 'bitcoin',
    ETH: 'ethereum',
  };

  constructor(
    private readonly httpRetry: HttpRetryService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  async getPrice(assetPair: string): Promise<PriceSourceResult> {
    try {
      const [base, counter] = assetPair.split('-');
      const baseId = this.assetMapping[base];
      const counterId = this.assetMapping[counter];

      if (!baseId || !counterId) {
        throw new Error(`Asset mapping not found for ${assetPair}`);
      }

      const { data } = await this.circuitBreaker.execute(
        CoinGeckoPriceProvider.CIRCUIT_NAME,
        () =>
          this.httpRetry.get(`${this.baseUrl}/simple/price`, {
            params: {
              ids: baseId,
              vs_currencies: counterId,
            },
            timeout: REQUEST_TIMEOUT_MS,
          }),
        { failureThreshold: 5, recoveryTimeMs: 30_000 },
      );

      const price = data[baseId]?.[counterId];
      if (!price) {
        throw new Error('Price not available');
      }

      return {
        price,
        source: 'CoinGecko',
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `CoinGecko price fetch failed for ${assetPair}: ${error.message}`,
      );
      throw error;
    }
  }
}
