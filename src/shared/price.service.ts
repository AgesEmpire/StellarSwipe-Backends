import { Injectable } from '@nestjs/common';

@Injectable()
export class PriceService {
  // Mock price service
  async getCurrentPrice(_symbol: string): Promise<number> {
    // Return a random price between 0.1 and 1000 for demo purposes
    // In a real app, this would fetch from an API or DB
    const basePrice = 100;
    const volatility = 0.5; // 50% volatility
    const randomFactor = 1 + (Math.random() * volatility * 2 - volatility);
    return parseFloat((basePrice * randomFactor).toFixed(8));
  }

  async getMultiplePrices(symbols: string[]): Promise<Record<string, number>> {
      const prices: Record<string, number> = {};
      for (const symbol of symbols) {
          prices[symbol] = await this.getCurrentPrice(symbol);
      }
      return prices;
  }
}
