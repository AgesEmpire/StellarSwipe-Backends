import { Injectable, Logger } from '@nestjs/common';
import { PriceSourceResult } from '../dto/price-data.dto';
import { HttpRetryService } from '../../http/http-retry.service';
import { CircuitBreakerService } from '../../http/circuit-breaker.service';

const REQUEST_TIMEOUT_MS = 5000;

@Injectable()
export class StellarExpertPriceProvider {
  private readonly logger = new Logger(StellarExpertPriceProvider.name);
  private readonly baseUrl = 'https://api.stellar.expert/explorer/public';
  private static readonly CIRCUIT_NAME = 'stellar-expert-price';

  constructor(
    private readonly httpRetry: HttpRetryService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  async getPrice(assetPair: string): Promise<PriceSourceResult> {
    try {
      const [base, counter] = assetPair.split('-');

      const { data } = await this.circuitBreaker.execute(
        StellarExpertPriceProvider.CIRCUIT_NAME,
        () =>
          this.httpRetry.get(`${this.baseUrl}/asset/${base}/price`, {
            params: { quote: counter },
            timeout: REQUEST_TIMEOUT_MS,
          }),
        { failureThreshold: 5, recoveryTimeMs: 30_000 },
      );

      if (!data?.price) {
        throw new Error('Price not available');
      }

      return {
        price: parseFloat(data.price),
        source: 'StellarExpert',
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `StellarExpert price fetch failed for ${assetPair}: ${error.message}`,
      );
      throw error;
    }
  }
}
