import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TradeSide } from '../trades/entities/trade.entity';

// ── Domain types ──────────────────────────────────────────────────────────────

export interface MarketOrderParams {
  userId: string;
  baseAsset: string;
  counterAsset: string;
  amount: number;
  entryPrice: number;
  side: TradeSide;
  slippageTolerance?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export interface LimitOrderParams {
  userId: string;
  baseAsset: string;
  counterAsset: string;
  amount: number;
  limitPrice: number;
  side: TradeSide;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  /** Unix timestamp; defaults to 24 hours from now */
  expiresAt?: number;
}

export interface UserRiskParameters {
  /** Maximum notional exposure the user is allowed to place in a single order */
  maxExposure?: number;
  /** Cap on position size as a fraction of available balance (0–1) */
  positionSizeCap?: number;
}

export interface SorobanTransactionPayload {
  contractId: string;
  method: string;
  args: ContractArg[];
  orderType: 'market' | 'limit';
  /** Effective amount after applying risk cap */
  adjustedAmount: number;
  /** Slippage expressed as bps for market orders (0 for limit) */
  slippageBps: number;
  metadata: {
    userId: string;
    baseAsset: string;
    counterAsset: string;
    side: TradeSide;
    stopLossPrice?: number;
    takeProfitPrice?: number;
    limitPrice?: number;
    expiresAt?: number;
  };
}

interface ContractArg {
  type: string;
  value: unknown;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class SorobanTransactionBuilderService {
  private readonly logger = new Logger(SorobanTransactionBuilderService.name);
  private readonly tradeContractId: string;
  private readonly defaultSlippageBps: number;
  private readonly maxSlippageBps: number;

  constructor(private readonly configService: ConfigService) {
    this.tradeContractId = this.configService.get<string>(
      'stellar.tradeContractId',
      'MOCK_CONTRACT_ID',
    );
    this.defaultSlippageBps = this.configService.get<number>(
      'trade.defaultSlippageBps',
      50,
    );
    this.maxSlippageBps = this.configService.get<number>(
      'trade.maxSlippageBps',
      500,
    );
  }

  /**
   * Builds and validates a Soroban payload for a market order.
   * Slippage is converted from a percentage (e.g. 0.5) to basis points.
   */
  buildMarketOrder(
    params: MarketOrderParams,
    userRisk: UserRiskParameters = {},
  ): SorobanTransactionPayload {
    this.validateAssetPair(params.baseAsset, params.counterAsset);
    this.validateAmount(params.amount, params.userId);

    const slippageBps = this.resolveSlippageBps(params.slippageTolerance);
    const adjustedAmount = this.applyRiskCap(params.amount, params.entryPrice, userRisk);

    const payload: SorobanTransactionPayload = {
      contractId: this.tradeContractId,
      method: 'execute_market_order',
      args: [
        { type: 'address', value: params.userId },
        { type: 'symbol', value: params.baseAsset },
        { type: 'symbol', value: params.counterAsset },
        { type: 'i128', value: this.toStroops(adjustedAmount) },
        { type: 'u32', value: slippageBps },
        { type: 'symbol', value: params.side },
      ],
      orderType: 'market',
      adjustedAmount,
      slippageBps,
      metadata: {
        userId: params.userId,
        baseAsset: params.baseAsset,
        counterAsset: params.counterAsset,
        side: params.side,
        stopLossPrice: params.stopLossPrice,
        takeProfitPrice: params.takeProfitPrice,
      },
    };

    this.validatePayload(payload);

    this.logger.debug(
      `Built market order payload for user=${params.userId} adjustedAmount=${adjustedAmount}`,
    );

    return payload;
  }

  /**
   * Builds and validates a Soroban payload for a limit order.
   */
  buildLimitOrder(
    params: LimitOrderParams,
    userRisk: UserRiskParameters = {},
  ): SorobanTransactionPayload {
    this.validateAssetPair(params.baseAsset, params.counterAsset);
    this.validateAmount(params.amount, params.userId);

    if (params.limitPrice <= 0) {
      throw new BadRequestException('Limit price must be greater than zero');
    }

    const adjustedAmount = this.applyRiskCap(
      params.amount,
      params.limitPrice,
      userRisk,
    );

    const expiresAt =
      params.expiresAt ?? Math.floor(Date.now() / 1000) + 86_400;

    const payload: SorobanTransactionPayload = {
      contractId: this.tradeContractId,
      method: 'place_limit_order',
      args: [
        { type: 'address', value: params.userId },
        { type: 'symbol', value: params.baseAsset },
        { type: 'symbol', value: params.counterAsset },
        { type: 'i128', value: this.toStroops(adjustedAmount) },
        { type: 'i128', value: this.toStroops(params.limitPrice) },
        { type: 'symbol', value: params.side },
        { type: 'u64', value: expiresAt },
      ],
      orderType: 'limit',
      adjustedAmount,
      slippageBps: 0,
      metadata: {
        userId: params.userId,
        baseAsset: params.baseAsset,
        counterAsset: params.counterAsset,
        side: params.side,
        limitPrice: params.limitPrice,
        stopLossPrice: params.stopLossPrice,
        takeProfitPrice: params.takeProfitPrice,
        expiresAt,
      },
    };

    this.validatePayload(payload);

    this.logger.debug(
      `Built limit order payload for user=${params.userId} limitPrice=${params.limitPrice} adjustedAmount=${adjustedAmount}`,
    );

    return payload;
  }

  /**
   * Validates a payload before it is dispatched to the Soroban RPC.
   * Throws BadRequestException for any structural problem.
   */
  validatePayload(payload: SorobanTransactionPayload): void {
    if (!payload.contractId) {
      throw new BadRequestException('Missing contractId in Soroban payload');
    }
    if (!payload.method) {
      throw new BadRequestException('Missing method in Soroban payload');
    }
    if (!payload.args || payload.args.length === 0) {
      throw new BadRequestException('Soroban payload has no contract arguments');
    }
    if (payload.adjustedAmount <= 0) {
      throw new BadRequestException('Payload adjustedAmount must be positive');
    }
    if (payload.slippageBps < 0 || payload.slippageBps > this.maxSlippageBps) {
      throw new BadRequestException(
        `slippageBps ${payload.slippageBps} out of allowed range [0, ${this.maxSlippageBps}]`,
      );
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Enforces user-specific max exposure; reduces amount if needed. */
  private applyRiskCap(
    amount: number,
    price: number,
    risk: UserRiskParameters,
  ): number {
    const notional = amount * price;
    if (risk.maxExposure && notional > risk.maxExposure) {
      const capped = risk.maxExposure / price;
      this.logger.warn(
        `Amount capped from ${amount} to ${capped.toFixed(8)} due to maxExposure=${risk.maxExposure}`,
      );
      return parseFloat(capped.toFixed(8));
    }
    return amount;
  }

  private resolveSlippageBps(slippagePct?: number): number {
    if (slippagePct === undefined) return this.defaultSlippageBps;
    const bps = Math.round(slippagePct * 100);
    return Math.min(bps, this.maxSlippageBps);
  }

  /** Converts a decimal amount to Stellar stroops (7 decimal places). */
  private toStroops(amount: number): string {
    return Math.round(amount * 10_000_000).toString();
  }

  private validateAssetPair(base: string, counter: string): void {
    if (!base || base.trim().length === 0) {
      throw new BadRequestException('baseAsset is required');
    }
    if (!counter || counter.trim().length === 0) {
      throw new BadRequestException('counterAsset is required');
    }
    if (base === counter) {
      throw new BadRequestException('baseAsset and counterAsset must differ');
    }
  }

  private validateAmount(amount: number, userId: string): void {
    if (!amount || amount <= 0) {
      throw new BadRequestException(
        `Invalid amount for user ${userId}: must be positive`,
      );
    }
  }
}
