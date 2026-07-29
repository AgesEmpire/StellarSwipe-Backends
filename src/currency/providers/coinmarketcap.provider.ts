import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BaseForexProvider, ForexRate } from './base-forex.provider';

@Injectable()
export class CoinMarketCapProvider extends BaseForexProvider {
  readonly providerName = 'coinmarketcap';
  private readonly logger = new Logger(CoinMarketCapProvider.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async getRate(base: string, quote: string): Promise<ForexRate> {
    const apiKey = this.configService.get<string>('COINMARKETCAP_API_KEY');
    const url = `https://pro-api.coinmarketcap.com/v1/tools/price-conversion?amount=1&symbol=${base}&convert=${quote}`;

    try {
      const { data } = await firstValueFrom(
        this.httpService.get(url, { headers: { 'X-CMC_PRO_API_KEY': apiKey } }),
      );
      const rate = data?.data?.quote?.[quote]?.price;
      if (!rate) throw new Error(`Rate not found for ${base}/${quote}`);
      return { base, quote, rate, provider: this.providerName, fetchedAt: new Date() };
    } catch (err) {
      this.logger.error(`CoinMarketCap getRate failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async getSupportedCurrencies(): Promise<string[]> {
    return ['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH', 'XLM'];
  }
}
