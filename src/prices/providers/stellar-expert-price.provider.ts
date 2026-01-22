import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PriceSourceResult } from '../dto/price-data.dto';

@Injectable()
export class StellarExpertPriceProvider {
  private readonly logger = new Logger(StellarExpertPriceProvider.name);
  private readonly baseUrl = 'https://api.stellar.expert/explorer/public';

  constructor(private readonly httpService: HttpService) {}

  async getPrice(assetPair: string): Promise<PriceSourceResult> {
    try {
      const [base, counter] = assetPair.split('-');

      const { data } = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/asset/${base}/price`, {
          params: { quote: counter },
        }),
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
