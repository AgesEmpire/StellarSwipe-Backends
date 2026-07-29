import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BaseForexProvider, ForexRate } from './base-forex.provider';

@Injectable()
export class FixerIoProvider extends BaseForexProvider {
  readonly providerName = 'fixer.io';
  private readonly logger = new Logger(FixerIoProvider.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async getRate(base: string, quote: string): Promise<ForexRate> {
    const apiKey = this.configService.get<string>('FIXER_IO_API_KEY');
    const url = `https://data.fixer.io/api/latest?access_key=${apiKey}&base=${base}&symbols=${quote}`;

    try {
      const { data } = await firstValueFrom(this.httpService.get(url));
      const rate = data?.rates?.[quote];
      if (!rate) throw new Error(`Rate not found for ${base}/${quote}`);
      return { base, quote, rate, provider: this.providerName, fetchedAt: new Date() };
    } catch (err) {
      this.logger.error(`FixerIo getRate failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async getSupportedCurrencies(): Promise<string[]> {
    const apiKey = this.configService.get<string>('FIXER_IO_API_KEY');
    const { data } = await firstValueFrom(
      this.httpService.get(`https://data.fixer.io/api/symbols?access_key=${apiKey}`),
    );
    return Object.keys(data?.symbols ?? {});
  }
}
