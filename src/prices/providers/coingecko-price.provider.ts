import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PriceSourceResult } from '../dto/price-data.dto';

@Injectable()
export class CoinGeckoPriceProvider {
  private readonly logger = new Logger(CoinGeckoPriceProvider.name);
  private readonly baseUrl = 'https://api.coingecko.com/api/v3';

  private readonly assetMapping = {
    XLM: 'stellar',
    USDC: 'usd-coin',
    BTC: 'bitcoin',
    ETH: 'ethereum',
  };

  constructor(private readonly httpService: HttpService) {}

  async getPrice(assetPair: string): Promise<PriceSourceResult> {
    try {
      const [base, counter] = assetPair.split('-');
      const baseId = this.assetMapping[base];
      const counterId = this.assetMapping[counter];

      if (!baseId || !counterId) {
        throw new Error(`Asset mapping not found for ${assetPair}`);
      }

      const { data } = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/simple/price`, {
          params: {
            ids: baseId,
            vs_currencies: counterId,
          },
        }),
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
