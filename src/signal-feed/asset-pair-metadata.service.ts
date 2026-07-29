import { Injectable } from '@nestjs/common';
import { PairMetadataDto } from './dto/signal-feed-response.dto';

interface PairEntry {
  displayName: string;
  iconUrl?: string;
  liquidityRating: 'high' | 'medium' | 'low';
}

const KNOWN_PAIRS: Record<string, PairEntry> = {
  'XLM/USDC': {
    displayName: 'Stellar / USD Coin',
    iconUrl: 'https://assets.stellarswipe.io/pairs/xlm-usdc.png',
    liquidityRating: 'high',
  },
  'XLM/USDT': {
    displayName: 'Stellar / Tether',
    iconUrl: 'https://assets.stellarswipe.io/pairs/xlm-usdt.png',
    liquidityRating: 'high',
  },
  'BTC/XLM': {
    displayName: 'Bitcoin / Stellar',
    iconUrl: 'https://assets.stellarswipe.io/pairs/btc-xlm.png',
    liquidityRating: 'medium',
  },
  'ETH/XLM': {
    displayName: 'Ethereum / Stellar',
    iconUrl: 'https://assets.stellarswipe.io/pairs/eth-xlm.png',
    liquidityRating: 'medium',
  },
  'USDC/USDT': {
    displayName: 'USD Coin / Tether',
    iconUrl: 'https://assets.stellarswipe.io/pairs/usdc-usdt.png',
    liquidityRating: 'high',
  },
};

@Injectable()
export class AssetPairMetadataService {
  /**
   * Returns metadata for a trading pair.
   * Falls back gracefully for unknown pairs.
   */
  getMetadata(base: string, quote: string): PairMetadataDto {
    const key = `${base.toUpperCase()}/${quote.toUpperCase()}`;
    const entry = KNOWN_PAIRS[key];

    if (entry) {
      return {
        base: base.toUpperCase(),
        quote: quote.toUpperCase(),
        displayName: entry.displayName,
        iconUrl: entry.iconUrl,
        liquidityRating: entry.liquidityRating,
      };
    }

    return this.fallback(base, quote);
  }

  /** Bulk lookup — returns a map keyed by "BASE/QUOTE" */
  getMetadataMap(pairs: Array<{ base: string; quote: string }>): Map<string, PairMetadataDto> {
    const map = new Map<string, PairMetadataDto>();
    for (const { base, quote } of pairs) {
      const key = `${base.toUpperCase()}/${quote.toUpperCase()}`;
      map.set(key, this.getMetadata(base, quote));
    }
    return map;
  }

  private fallback(base: string, quote: string): PairMetadataDto {
    return {
      base: base.toUpperCase(),
      quote: quote.toUpperCase(),
      displayName: `${base.toUpperCase()} / ${quote.toUpperCase()}`,
      iconUrl: undefined,
      liquidityRating: 'unknown',
    };
  }
}
