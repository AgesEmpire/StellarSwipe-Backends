export interface DexAdapter {
  readonly dexName: string;
  readonly dexId: string;

  getQuote(request: QuoteRequest): Promise<DexQuote>;
  getLiquidityPools(assetPair: AssetPair): Promise<LiquidityPoolInfo[]>;
  getOrderBook(assetPair: AssetPair): Promise<OrderBook>;
  isHealthy(): Promise<boolean>;
}

export interface AssetPair {
  baseAsset: StellarAsset;
  counterAsset: StellarAsset;
}

export interface StellarAsset {
  code: string;
  issuer?: string; // undefined for XLM
  type: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
}

export interface DexQuote {
  dexId: string;
  dexName: string;
  sourceAmount: string;
  destinationAmount: string;
  price: number;
  priceInverse: number;
  fee: number;
  feeAsset: StellarAsset;
  path: StellarAsset[];
  estimatedSlippage: number;
  confidence: number; // 0-1 score
  timestamp: Date;
  expiresAt: Date;
}

export interface LiquidityPoolInfo {
  poolId: string;
  dexId: string;
  assets: StellarAsset[];
  totalValueLocked: number;
  volume24h: number;
  fee: number;
  reserveA: string;
  reserveB: string;
}

export interface OrderBook {
  dexId: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  spread: number;
  midPrice: number;
}

export interface OrderBookEntry {
  price: string;
  amount: string;
  total: string;
}
