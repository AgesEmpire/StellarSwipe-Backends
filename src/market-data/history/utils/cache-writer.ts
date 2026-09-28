import { Cache } from 'cache-manager';
import { PriceHistory } from '../../../prices/entities/price-history.entity';

export const HISTORICAL_PRICE_CACHE_PREFIX = 'historical-price-history';
export const HISTORICAL_PRICE_CACHE_TTL_MS = 30 * 60 * 1000;

export function historicalPriceCacheKey(assetPair: string, hours: number): string {
  return `${HISTORICAL_PRICE_CACHE_PREFIX}:${assetPair}:${hours}`;
}

export interface HistoricalPriceCacheEntry {
  assetPair: string;
  hours: number;
  refreshedAt: string;
  history: Array<Pick<PriceHistory, 'id' | 'assetPair' | 'price' | 'source' | 'metadata' | 'timestamp' | 'createdAt'>>;
}

export function toHistoricalPriceCacheEntry(
  assetPair: string,
  hours: number,
  history: PriceHistory[],
): HistoricalPriceCacheEntry {
  return {
    assetPair,
    hours,
    refreshedAt: new Date().toISOString(),
    history: history.map((row) => ({
      id: row.id,
      assetPair: row.assetPair,
      price: Number(row.price),
      source: row.source,
      metadata: row.metadata,
      timestamp: row.timestamp,
      createdAt: row.createdAt,
    })),
  };
}

export function hydrateHistoricalPriceCacheEntry(
  entry: HistoricalPriceCacheEntry,
): PriceHistory[] {
  return entry.history.map((row) => ({
    ...row,
    timestamp: new Date(row.timestamp),
    createdAt: new Date(row.createdAt),
  })) as PriceHistory[];
}

export async function writeHistoricalPriceCache(
  cache: Cache,
  assetPair: string,
  hours: number,
  history: PriceHistory[],
): Promise<void> {
  const key = historicalPriceCacheKey(assetPair, hours);
  await cache.set(
    key,
    toHistoricalPriceCacheEntry(assetPair, hours, history),
    HISTORICAL_PRICE_CACHE_TTL_MS,
  );
}

export async function readHistoricalPriceCache(
  cache: Cache,
  assetPair: string,
  hours: number,
): Promise<PriceHistory[] | null> {
  const entry = await cache.get<HistoricalPriceCacheEntry>(
    historicalPriceCacheKey(assetPair, hours),
  );

  if (!entry) {
    return null;
  }

  return hydrateHistoricalPriceCacheEntry(entry);
}
