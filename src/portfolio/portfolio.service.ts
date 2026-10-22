import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, EntityManager } from 'typeorm';
import { Trade, TradeStatus } from '../trades/entities/trade.entity';
import { User } from '../users/entities/user.entity';
import { PriceService } from '../shared/price.service';
import { OutboxService } from '../events/outbox.service';
import { PortfolioTransactionCreatedEvent } from '../events/portfolio.events';
import { PositionDetailDto } from './dto/position-detail.dto';
import { PortfolioSummaryDto, TradeDetail } from './dto/portfolio-summary.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PnlCalculatorService } from './services/pnl-calculator.service';
import { AddTransactionDto } from './dto/add-transaction.dto';
import { PnlHistory } from './entities/pnl-history.entity';

// Stellar public key: 56 chars, base32, starts with G
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

// Portfolio import batch limits and validation
const MAX_IMPORT_BATCH_SIZE = 500;
const MAX_IMPORT_PRECISION = 8;
const MAX_IMPORT_SCALE = 8;
const ASSET_CODE_RE = /^[A-Z0-9]{1,12}$/;

// Imports at or above this row count are processed asynchronously in the background.
const ASYNC_IMPORT_THRESHOLD = 50;

// Rebalance preview: trade amounts are quantized to this many decimal places.
const REBALANCE_PRECISION = 8;

// Rebalance preview: allocations below this fraction of the target are ignored
// to avoid emitting dust trades caused by floating point noise.
const REBALANCE_DUST_THRESHOLD = 1e-8;

// Profit breakdown: values are quantized to this many decimal places.
const PROFIT_PRECISION = 8;

// Profit breakdown: floating point tolerance for reconciliation checks.
const PROFIT_RECONCILE_EPSILON = 1e-6;

export enum PortfolioImportStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface PortfolioImportJob {
  id: string;
  userId: string;
  status: PortfolioImportStatus;
  totalRows: number;
  processedRows: number;
  importedCount: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface PortfolioImportRow {
  baseAsset: string;
  counterAsset: string;
  amount: number | string;
  entryPrice: number | string;
  feeAmount?: number | string;
}

interface PortfolioImportRowError {
  row: number;
  field: string;
  message: string;
}

export interface RebalanceTargetAllocation {
  asset: string;
  targetWeight: number;
}

export interface RebalancePreviewTrade {
  asset: string;
  side: 'BUY' | 'SELL';
  currentWeight: number;
  targetWeight: number;
  currentValue: number;
  targetValue: number;
  amount: number;
}

export interface RebalancePreviewResult {
  totalValue: number;
  trades: RebalancePreviewTrade[];
  insufficientData: boolean;
  missingPrices: string[];
}

/**
 * A single open lot tracked for FIFO cost basis accounting.
 */
export interface ProfitLot {
  asset: string;
  quantity: number;
  costBasis: number;
}

/**
 * Realized and unrealized profit components for a single asset.
 * `supported` is false when a reliable price or cost basis is unavailable;
 * in that case the numeric fields are reported as 0 and the reason is set.
 */
export interface AssetProfitBreakdown {
  asset: string;
  realizedProfit: number;
  unrealizedProfit: number;
  totalProfit: number;
  supported: boolean;
  reason?: string;
}

/**
 * Portfolio-level profit breakdown. `realizedProfit + unrealizedProfit`
 * reconciles to `totalProfit` for all supported assets.
 */
export interface PortfolioProfitBreakdown {
  realizedProfit: number;
  unrealizedProfit: number;
  totalProfit: number;
  reconciled: boolean;
  assets: AssetProfitBreakdown[];
  unsupportedAssets: string[];
}

@Injectable()
export class PortfolioService {
  // Durable in-memory job registry keyed by job id. Each job is owned by a userId
  // so status lookups can be scoped to the requester.
  private readonly importJobs = new Map<string, PortfolioImportJob>();

  constructor(
    @InjectRepository(Trade)
    private tradeRepository: Repository<Trade>,
    @InjectRepository(PnlHistory)
    private pnlHistoryRepository: Repository<PnlHistory>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private priceService: PriceService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private pnlCalculator: PnlCalculatorService,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Quantizes a numeric amount to a fixed number of decimal places so that
   * preview output is deterministic and free of floating point noise.
   */
  private quantize(value: number, precision: number = REBALANCE_PRECISION): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  }

  /**
   * Builds consistent freshness metadata for a valuation response.
   * `source` identifies where the valuation came from (live prices vs cache),
   * `stale` tells clients whether the value should be treated as an estimate.
   */
  private buildFreshness(
    source: string,
    valuedAt: Date,
    now: Date = new Date(),
  ): { valuedAt: string; source: string; stale: boolean; ageMs: number } {
    const ageMs = Math.max(0, now.getTime() - valuedAt.getTime());
    return {
      valuedAt: valuedAt.toISOString(),
      source,
      stale: ageMs > VALUATION_STALE_THRESHOLD_MS,
      ageMs,
    };
  }

  /**
   * Computes realized and unrealized profit components for a user's portfolio.
   *
   * Cost basis rules (documented):
   * - Executed BUY trades open lots at their entry price (FIFO queue per asset).
   * - Executed SELL trades consume the oldest open lots first (FIFO). Realized
   *   profit for a sell is `proceeds - consumedCostBasis`.
   * - Unrealized profit for remaining open lots is `marketValue - remainingCostBasis`
   *   using the current market price for each asset.
   *
   * Assets with no reliable market price (for unrealized) or a sell that exceeds
   * available lots (no reliable cost basis) are marked unsupported rather than
   * silently producing a number. `realizedProfit + unrealizedProfit` reconciles
   * to `totalProfit` across supported assets.
   */
  async getProfitBreakdown(userId: string): Promise<PortfolioProfitBreakdown> {
    const trades = await this.tradeRepository.find({
      where: { userId, status: TradeStatus.COMPLETED },
      order: { createdAt: 'ASC' },
    });

    // FIFO lot queues keyed by base asset.
    const lots = new Map<string, ProfitLot[]>();
    const realizedByAsset = new Map<string, number>();
    const unsupported = new Set<string>();
    const unsupportedReasons = new Map<string, string>();

    const markUnsupported = (asset: string, reason: string) => {
      unsupported.add(asset);
      if (!unsupportedReasons.has(asset)) {
        unsupportedReasons.set(asset, reason);
      }
    };

    for (const trade of trades) {
      const asset = trade.baseAsset;
      const quantity = Number(trade.amount);
      const price = Number(trade.entryPrice);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        markUnsupported(asset, 'Invalid trade quantity');
        continue;
      }
      if (!Number.isFinite(price) || price < 0) {
        markUnsupported(asset, 'Missing cost basis (entry price)');
        continue;
      }

      const side = String(trade.side || '').toUpperCase();

      if (side === 'BUY') {
        const queue = lots.get(asset) || [];
        queue.push({ asset, quantity, costBasis: quantity * price });
        lots.set(asset, queue);
      } else if (side === 'SELL') {
        const queue = lots.get(asset) || [];
        let remaining = quantity;
        let consumedCost = 0;

        while (remaining > 0 && queue.length > 0) {
          const lot = queue[0];
          const take = Math.min(lot.quantity, remaining);
          const unitCost = lot.quantity > 0 ? lot.costBasis / lot.quantity : 0;
          consumedCost += take * unitCost;
          lot.quantity -= take;
          lot.costBasis -= take * unitCost;
          remaining -= take;
          if (lot.quantity <= 1e-12) {
            queue.shift();
          }
        }

        if (remaining > 1e-12) {
          // Sold more than we have lots for: cost basis is unreliable.
          markUnsupported(asset, 'Sell exceeds available cost basis lots');
          continue;
        }

        const proceeds = quantity * price;
        const realized = proceeds - consumedCost;
        realizedByAsset.set(asset, (realizedByAsset.get(asset) || 0) + realized);
      }
    }

    // Collect all assets that have open lots or realized profit.
    const assetSet = new Set<string>([
      ...lots.keys(),
      ...realizedByAsset.keys(),
      ...unsupported,
    ]);
    const assets = [...assetSet].sort();

    // Fetch current market prices for assets with open lots.
    const symbols = assets
      .filter((a) => (lots.get(a) || []).length > 0)
      .map((a) => a);
    const prices = symbols.length > 0 ? await this.priceService.getMultiplePrices(symbols) : {};

    const breakdowns: AssetProfitBreakdown[] = [];
    let totalRealized = 0;
    let totalUnrealized = 0;

    for (const asset of assets) {
      const realized = realizedByAsset.get(asset) || 0;
      const queue = lots.get(asset) || [];
      const remainingCost = queue.reduce((sum, lot) => sum + lot.costBasis, 0);
      const remainingQty = queue.reduce((sum, lot) => sum + lot.quantity, 0);

      let unrealized = 0;
      let supported = !unsupported.has(asset);
      let reason = unsupportedReasons.get(asset);

      if (remainingQty > 1e-12) {
        const price = prices[asset];
        if (price === undefined || price === null || !Number.isFinite(Number(price))) {
          supported = false;
          reason = reason || 'Missing market price for unrealized valuation';
        } else {
          unrealized = remainingQty * Number(price) - remainingCost;
        }
      }

      const realizedQ = this.quantize(realized, PROFIT_PRECISION);
      const unrealizedQ = this.quantize(unrealized, PROFIT_PRECISION);

      if (supported) {
        totalRealized += realizedQ;
        totalUnrealized += unrealizedQ;
      }

      breakdowns.push({
        asset,
        realizedProfit: supported ? realizedQ : 0,
        unrealizedProfit: supported ? unrealizedQ : 0,
        totalProfit: supported ? this.quantize(realizedQ + unrealizedQ, PROFIT_PRECISION) : 0,
        supported,
        ...(reason ? { reason } : {}),
      });
    }

    const realizedProfit = this.quantize(totalRealized, PROFIT_PRECISION);
    const unrealizedProfit = this.quantize(totalUnrealized, PROFIT_PRECISION);
    const totalProfit = this.quantize(realizedProfit + unrealizedProfit, PROFIT_PRECISION);
    const reconciled =
      Math.abs(realizedProfit + unrealizedProfit - totalProfit) <= PROFIT_RECONCILE_EPSILON;

    return {
      realizedProfit,
      unrealizedProfit,
      totalProfit,
      reconciled,
      assets: breakdowns,
      unsupportedAssets: [...unsupported].sort(),
    };
  }

  /**
   * Calculates proposed trades to reach a target allocation without submitting
   * orders or mutating holdings. The result is deterministic for the same
   * inputs: trades are ordered by asset and amounts are quantized.
   */
  async previewRebalance(
    userId: string,
    targets: RebalanceTargetAllocation[],
  ): Promise<RebalancePreviewResult> {
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new BadRequestException('At least one target allocation is required');
    }

    const weightSum = targets.reduce((sum, t) => sum + Number(t.targetWeight || 0), 0);
    if (Math.abs(weightSum - 1) > 1e-6) {
      throw new BadRequestException('Target weights must sum to 1');
    }

    const openTrades = await this.tradeRepository.find({
      where: {
        userId,
        status: In([TradeStatus.PENDING, TradeStatus.EXECUTING]),
      },
      order: { createdAt: 'DESC' },
    });

    const symbols = [...new Set(openTrades.map((t) => `${t.baseAsset}/${t.counterAsset}`))];
    const prices = symbols.length > 0 ? await this.priceService.getMultiplePrices(symbols) : {};

    // Aggregate current holdings value per asset symbol.
    const currentValues = new Map<string, number>();
    const missingPrices: string[] = [];

    for (const trade of openTrades) {
      const pair = `${trade.baseAsset}/${trade.counterAsset}`;
      const price = prices[pair];
      if (price === undefined || price === null || !Number.isFinite(Number(price))) {
        if (!missingPrices.includes(pair)) {
          missingPrices.push(pair);
        }
        continue;
      }
      const value = Number(trade.amount) * Number(price);
      currentValues.set(pair, (currentValues.get(pair) || 0) + value);
    }

    const totalValue = this.quantize(
      [...currentValues.values()].reduce((sum, v) => sum + v, 0),
    );

    const insufficientData = missingPrices.length > 0 || totalValue <= 0;

    // Build a deterministic, sorted set of assets to consider.
    const assetSet = new Set<string>([
      ...currentValues.keys(),
      ...targets.map((t) => t.asset),
    ]);
    const assets = [...assetSet].sort();

    const targetByAsset = new Map<string, number>();
    for (const t of targets) {
      targetByAsset.set(t.asset, Number(t.targetWeight || 0));
    }

    const trades: RebalancePreviewTrade[] = [];

    for (const asset of assets) {
      const currentValue = currentValues.get(asset) || 0;
      const targetWeight = targetByAsset.get(asset) || 0;
      const targetValue = totalValue * targetWeight;
      const delta = targetValue - currentValue;

      const currentWeight = totalValue > 0 ? currentValue / totalValue : 0;

      if (Math.abs(delta) < REBALANCE_DUST_THRESHOLD) {
        continue;
      }

      const price = prices[asset];
      const amount = price && Number.isFinite(Number(price)) && Number(price) > 0
        ? this.quantize(Math.abs(delta) / Number(price))
        : this.quantize(Math.abs(delta));

      if (amount <= 0) {
        continue;
      }

      trades.push({
        asset,
        side: delta > 0 ? 'BUY' : 'SELL',
        currentWeight: this.quantize(currentWeight),
        targetWeight: this.quantize(targetWeight),
        currentValue: this.quantize(currentValue),
        targetValue: this.quantize(targetValue),
        amount,
      });
    }

    return {
      totalValue,
      trades,
      insufficientData,
      missingPrices: missingPrices.sort(),
    };
  }

  /**
   * Centralized archival eligibility rules for a po

/* … truncated 4685 chars — edit only what you need near the top … */
