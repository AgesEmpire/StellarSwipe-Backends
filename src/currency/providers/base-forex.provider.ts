export interface ForexRate {
  base: string;
  quote: string;
  rate: number;
  provider: string;
  fetchedAt: Date;
}

export abstract class BaseForexProvider {
  abstract readonly providerName: string;

  abstract getRate(base: string, quote: string): Promise<ForexRate>;

  abstract getSupportedCurrencies(): Promise<string[]>;
}
