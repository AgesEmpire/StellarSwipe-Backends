import { Injectable, BadRequestException } from '@nestjs/common';
import { BaseLocalProvider } from '../providers/base-local.provider';
import { MpesaProvider } from '../providers/mpesa.provider';
import { PaystackProvider } from '../providers/paystack.provider';
import { PixProvider } from '../providers/pix.provider';
import { UpiProvider } from '../providers/upi.provider';

@Injectable()
export class RegionalRouter {
  private readonly providers: BaseLocalProvider[];

  constructor(
    private readonly mpesa: MpesaProvider,
    private readonly paystack: PaystackProvider,
    private readonly pix: PixProvider,
    private readonly upi: UpiProvider,
  ) {
    this.providers = [mpesa, paystack, pix, upi];
  }

  resolveProvider(country: string, currency: string): BaseLocalProvider {
    const provider = this.providers.find((p) => p.supports(currency, country));
    if (!provider) {
      throw new BadRequestException(
        `No local payment provider available for country=${country} currency=${currency}`,
      );
    }
    return provider;
  }

  resolveByName(name: string): BaseLocalProvider {
    const provider = this.providers.find((p) => p.providerName === name.toLowerCase());
    if (!provider) throw new BadRequestException(`Unknown payment provider: ${name}`);
    return provider;
  }

  getAvailableProviders(country: string): BaseLocalProvider[] {
    return this.providers.filter((p) => p.supportedCountries.includes(country.toUpperCase()));
  }

  listAll(): Array<{ name: string; currencies: string[]; countries: string[] }> {
    return this.providers.map((p) => ({
      name: p.providerName,
      currencies: p.supportedCurrencies,
      countries: p.supportedCountries,
    }));
  }
}
