import { DexQuote } from '../interfaces/dex-adapter.interface';

export interface PriceComparison {
  bestQuote: DexQuote;
  rankedQuotes: RankedQuote[];
  spreadPercent: number;
  averagePrice: number;
  priceStdDev: number;
}

export interface RankedQuote extends DexQuote {
  rank: number;
  netPrice: number;
  priceDifferencePercent: number;
  score: number;
}

export class PriceComparator {
  /**
   * Compare quotes from multiple DEXes and rank them.
   * Scoring weights: destination amount (60%), fee (25%), confidence (15%)
   */
  static compare(quotes: DexQuote[]): PriceComparison {
    if (!quotes.length) {
      throw new Error('No quotes provided for comparison');
    }

    const prices = quotes.map((q) => q.price);
    const averagePrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const priceStdDev = PriceComparator.standardDeviation(prices);

    const ranked = PriceComparator.rankQuotes(quotes);
    const bestQuote = ranked[0];
    const worstQuote = ranked[ranked.length - 1];

    const spreadPercent =
      worstQuote.price > 0
        ? ((bestQuote.price - worstQuote.price) / worstQuote.price) * 100
        : 0;

    return {
      bestQuote,
      rankedQuotes: ranked,
      spreadPercent,
      averagePrice,
      priceStdDev,
    };
  }

  static rankQuotes(quotes: DexQuote[]): RankedQuote[] {
    const maxDstAmount = Math.max(
      ...quotes.map((q) => parseFloat(q.destinationAmount)),
    );
    const minFee = Math.min(...quotes.map((q) => q.fee));
    const maxConf = Math.max(...quotes.map((q) => q.confidence));

    const scored = quotes.map((q) => {
      const dstScore =
        maxDstAmount > 0
          ? (parseFloat(q.destinationAmount) / maxDstAmount) * 60
          : 0;
      const feeScore = minFee > 0 ? (minFee / q.fee) * 25 : 25;
      const confScore = maxConf > 0 ? (q.confidence / maxConf) * 15 : 15;
      const totalScore = dstScore + feeScore + confScore;

      const netPrice = q.price * (1 - q.fee);

      return { ...q, netPrice, score: totalScore, rank: 0, priceDifferencePercent: 0 };
    });

    scored.sort((a, b) => b.score - a.score);

    const bestNetPrice = scored[0].netPrice;
    return scored.map((q, idx) => ({
      ...q,
      rank: idx + 1,
      priceDifferencePercent:
        bestNetPrice > 0
          ? ((q.netPrice - bestNetPrice) / bestNetPrice) * 100
          : 0,
    }));
  }

  static findArbitrageOpportunities(
    quotes: DexQuote[],
    minSpreadPercent = 0.5,
  ): ArbitrageOpportunity[] {
    if (quotes.length < 2) return [];

    const opportunities: ArbitrageOpportunity[] = [];
    for (let i = 0; i < quotes.length; i++) {
      for (let j = i + 1; j < quotes.length; j++) {
        const spread =
          Math.abs(quotes[i].price - quotes[j].price) /
          Math.min(quotes[i].price, quotes[j].price) *
          100;

        if (spread >= minSpreadPercent) {
          const buyDex = quotes[i].price < quotes[j].price ? quotes[i] : quotes[j];
          const sellDex = quotes[i].price > quotes[j].price ? quotes[i] : quotes[j];

          opportunities.push({
            buyDexId: buyDex.dexId,
            sellDexId: sellDex.dexId,
            buyPrice: buyDex.price,
            sellPrice: sellDex.price,
            spreadPercent: spread,
            estimatedProfitPercent:
              spread - (buyDex.fee + sellDex.fee) * 100,
          });
        }
      }
    }

    return opportunities.sort(
      (a, b) => b.estimatedProfitPercent - a.estimatedProfitPercent,
    );
  }

  private static standardDeviation(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map((v) => Math.pow(v - mean, 2));
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
  }
}

export interface ArbitrageOpportunity {
  buyDexId: string;
  sellDexId: string;
  buyPrice: number;
  sellPrice: number;
  spreadPercent: number;
  estimatedProfitPercent: number;
}
