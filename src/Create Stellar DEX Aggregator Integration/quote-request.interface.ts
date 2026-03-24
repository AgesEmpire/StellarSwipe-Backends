import { StellarAsset } from './dex-adapter.interface';

export interface QuoteRequest {
  sourceAsset: StellarAsset;
  destinationAsset: StellarAsset;
  sourceAmount?: string;
  destinationAmount?: string;
  slippageTolerance?: number; // percentage, e.g. 0.5 for 0.5%
  maxHops?: number; // maximum path hops for multi-hop routing
  excludeDexes?: string[]; // dex IDs to exclude
  preferDexes?: string[]; // preferred dex IDs
}

export interface RouteRequest extends QuoteRequest {
  optimizationStrategy: 'best_price' | 'lowest_fee' | 'fastest' | 'balanced';
  splitRouting?: boolean; // allow splitting across multiple DEXes
  maxSplits?: number;
}
