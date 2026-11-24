import { TradeSide, TradeStatus } from '../entities/trade.entity';

/** Closing a BUY position sells the base asset; closing a SELL position buys it back. */
export type CloseDirection = 'sell_base' | 'buy_base';

export interface CloseQuoteRequest {
  baseAsset: string;
  counterAsset: string;
  direction: CloseDirection;
  /** Base-asset quantity to close. */
  amount: number;
}

export interface CloseQuote {
  /** Top-of-book price (counter per base). */
  bestPrice: number;
  /** Volume-weighted price for the full amount (counter per base). */
  averagePrice: number;
  /** Whether visible depth covers the whole amount. */
  sufficientLiquidity: boolean;
  source: string;
  asOf: string;
}

/** Read-only market data used for estimates. Must have no side effects. */
export interface CloseQuoteSource {
  quote(request: CloseQuoteRequest): Promise<CloseQuote | null>;
}
export const CLOSE_QUOTE_SOURCE = Symbol('CLOSE_QUOTE_SOURCE');

export interface ClosePositionCommand {
  tradeId: string;
  userId: string;
  /** Version seen in the preview; the close is rejected if the position changed since. */
  version: number;
}

export interface ClosePositionOutcome {
  exitPrice?: string;
  profitLoss?: string;
  transactionHash?: string;
}

/** Executes a single position close (bound to TradesService.closeTrade in production). */
export interface PositionCloser {
  close(command: ClosePositionCommand): Promise<ClosePositionOutcome>;
}
export const CLOSE_ALL_POSITION_CLOSER = Symbol('CLOSE_ALL_POSITION_CLOSER');

export enum IneligibleReason {
  /** Submitted but not yet settled on-chain; cannot be closed yet. */
  PENDING_SETTLEMENT = 'PENDING_SETTLEMENT',
  /** Open, but in a status the close path does not accept. */
  UNSUPPORTED_STATUS = 'UNSUPPORTED_STATUS',
  ZERO_QUANTITY = 'ZERO_QUANTITY',
  PRICE_UNAVAILABLE = 'PRICE_UNAVAILABLE',
  INSUFFICIENT_LIQUIDITY = 'INSUFFICIENT_LIQUIDITY',
}

export interface EligiblePositionEstimate {
  positionId: string;
  side: TradeSide;
  baseAsset: string;
  counterAsset: string;
  status: TradeStatus;
  version: number;
  amount: string;
  entryPrice: string;
  /** All estimates below are in the counter asset unless suffixed Xlm. */
  estimatedExitPrice: string;
  bestPrice: string;
  estimatedSlippageBps: number;
  estimatedSlippageCost: string;
  estimatedNotional: string;
  estimatedPlatformFee: string;
  estimatedNetworkFeeXlm: string;
  estimatedRealizedPnl: string;
  quoteSource: string;
}

export interface IneligiblePosition {
  positionId: string;
  side: TradeSide;
  baseAsset: string;
  counterAsset: string;
  status: TradeStatus;
  amount: string;
  reason: IneligibleReason;
  detail: string;
}

export interface CloseAllTotals {
  counterAsset: string;
  positions: number;
  estimatedNotional: string;
  estimatedSlippageCost: string;
  estimatedPlatformFee: string;
  estimatedRealizedPnl: string;
}

export interface CloseAllPreview {
  previewId: string;
  userId: string;
  generatedAt: string;
  expiresAt: string;
  /** Opaque, signed. Send it to the confirm endpoint unchanged. */
  previewToken: string;
  fingerprint: string;
  eligible: EligiblePositionEstimate[];
  ineligible: IneligiblePosition[];
  /** Grouped by counter asset — amounts in different assets are not summed. */
  totals: CloseAllTotals[];
  estimatedNetworkFeeXlm: string;
  assumptions: {
    maxPriceDriftBps: number;
    platformFeeBps: number;
    networkFeePerCloseXlm: string;
    ttlSeconds: number;
  };
}

export type CloseAllPositionResult =
  | ({ positionId: string; status: 'closed' } & ClosePositionOutcome)
  | { positionId: string; status: 'failed'; error: string };

export interface CloseAllConfirmationResult {
  confirmationId: string;
  previewId: string;
  status: 'executing' | 'completed' | 'completed_with_failures';
  /** True when this response replays an earlier confirmation of the same preview. */
  replayed: boolean;
  requested: number;
  closed: number;
  failed: number;
  results: CloseAllPositionResult[];
  confirmedAt: string;
  completedAt: string | null;
}
