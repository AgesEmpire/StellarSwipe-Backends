import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/**
 * PriceService abstracts all price-feed integrations.
 * Swap the implementation to plug in Binance, CoinGecko, a WebSocket feed, etc.
 */
@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);

  constructor(private readonly httpService: HttpService) {}

  /**
   * Fetches current prices for a list of symbols in a single round-trip.
   * Returns a Map<symbol, price>. Missing symbols are omitted.
   */
  async getBatchPrices(symbols: string[]): Promise<Map<string, number>> {
    const priceMap = new Map<string, number>();
    if (!symbols.length) return priceMap;

    try {
      // Example: Binance ticker endpoint (replace with your exchange)
      const symbolParam = symbols.map((s) => `"${s}"`).join(',');
      const { data } = await firstValueFrom(
        this.httpService.get(
          `https://api.binance.com/api/v3/ticker/price?symbols=[${symbolParam}]`,
        ),
      );

      for (const entry of data as Array<{ symbol: string; price: string }>) {
        const price = parseFloat(entry.price);
        if (!isNaN(price) && price > 0) {
          priceMap.set(entry.symbol, price);
        }
      }
    } catch (err) {
      this.logger.error(`Failed to fetch batch prices: ${err.message}`);
      // Return empty map — monitor will skip affected positions and retry next tick
    }

    return priceMap;
  }

  async getPrice(symbol: string): Promise<number | null> {
    const map = await this.getBatchPrices([symbol]);
    return map.get(symbol) ?? null;
  }
}
