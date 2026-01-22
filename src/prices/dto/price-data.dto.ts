export class PriceDataDto {
  assetPair: string;
  price: number;
  source: string;
  timestamp: Date;
  confidence: number;
  sourcesUsed: string[];
  deviation?: number;
}

export class PriceSourceResult {
  price: number;
  source: string;
  timestamp: Date;
}
