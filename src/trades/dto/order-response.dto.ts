export interface MarketOrderResponseDto {
  hash: string;
  orderType: 'market';
  status: 'filled';
  priceEstimate: {
    averagePrice: number;
    bestPrice: number;
    worstPrice?: number;
  };
  slippagePercent: number;
  filledAmount: number;
  timestamp: Date;
}

export interface LimitOrderResponseDto {
  hash: string;
  orderType: 'limit';
  status: 'open' | 'partially_filled' | 'filled';
  limitPrice: number;
  filledAmount?: number;
  remainingAmount?: number;
  offerId?: string;
  timestamp: Date;
}

export interface OrderErrorDto {
  error: string;
  code: string;
  details?: Record<string, any>;
}
