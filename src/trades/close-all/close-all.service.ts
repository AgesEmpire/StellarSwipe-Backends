import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Trade, TradeSide, TradeStatus } from '../entities/trade.entity';
import { assertOwnership } from '../../authorization/utils/assert-ownership.util';
import { CloseAllConfirmation } from './close-all-confirmation.entity';
import { CloseAllPreviewTokenPayload, signPreviewToken, verifyPreviewToken } from './close-all-preview.token';
import { slippageBps } from './orderbook-estimate';
import {
  CLOSE_ALL_POSITION_CLOSER,
  CLOSE_QUOTE_SOURCE,
  CloseAllConfirmationResult,
  CloseAllPositionResult,
  CloseAllPreview,
  CloseAllTotals,
  CloseQuoteSource,
  EligiblePositionEstimate,
  IneligiblePosition,
  IneligibleReason,
  PositionCloser,
} from './close-all.types';

/** Statuses of a trade that represents an open (not yet closed) position. */
export const OPEN_POSITION_STATUSES: TradeStatus[] = [
  TradeStatus.PENDING,
  TradeStatus.EXECUTING,
  TradeStatus.CONFIRMED,
  TradeStatus.SETTLED,
  TradeStatus.COMPLETED,
];
/** Only these can be closed by TradesService.closeTrade. */
export const CLOSEABLE_STATUSES: TradeStatus[] = [TradeStatus.COMPLETED];
const PENDING_STATUSES: TradeStatus[] = [TradeStatus.PENDING, TradeStatus.EXECUTING, TradeStatus.CONFIRMED];

export interface CloseAllActor {
  id: string;
  roles?: string[];
}

interface PortfolioSnapshot {
  eligible: EligiblePositionEstimate[];
  ineligible: IneligiblePosition[];
  fingerprint: string;
}

const fx = (n: number) => (Number.isFinite(n) ? n.toFixed(8) : '0.00000000');
const isUniqueViolation = (e: unknown) =>
  (e as any)?.driverError?.code === '23505' || (e as any)?.code === '23505';

/**
 * Close-all positions as a two-step workflow (#1537):
 *
 * 1. preview — read-only. Lists eligible and ineligible positions with
 *    estimated exit price, slippage and fees, and returns a signed token that
 *    binds the confirmation to exactly this portfolio state. Nothing is
 *    written and nothing is executed.
 * 2. confirm — verifies the token, rejects it if expired (410) or if the
 *    portfolio has materially changed (409: positions added/removed/modified,
 *    eligibility changed, or price moved beyond the drift limit), then closes
 *    the previewed positions. Confirmation is idempotent per preview: repeats
 *    and concurrent duplicates return the original result.
 */
@Injectable()
export class CloseAllPositionsService {
  private readonly logger = new Logger(CloseAllPositionsService.name);
  private ephemeralSecret?: string;

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    @InjectRepository(CloseAllConfirmation)
    private readonly confirmationRepo: Repository<CloseAllConfirmation>,
    @Inject(CLOSE_QUOTE_SOURCE)
    private readonly quotes: CloseQuoteSource,
    @Inject(CLOSE_ALL_POSITION_CLOSER)
    private readonly closer: PositionCloser,
    private readonly config: ConfigService,
  ) {}

  private get ttlSeconds(): number {
    return Number(this.config.get('CLOSE_ALL_PREVIEW_TTL_SECONDS', 60));
  }
  private get maxPriceDriftBps(): number {
    return Number(this.config.get('CLOSE_ALL_MAX_PRICE_DRIFT_BPS', 100));
  }
  private get platformFeeBps(): number {
    return Number(this.config.get('CLOSE_ALL_PLATFORM_FEE_BPS', 0));
  }
  private get networkFeePerCloseXlm(): number {
    return Number(this.config.get('CLOSE_ALL_NETWORK_FEE_XLM', 0.00001));
  }

  private get secret(): string {
    const configured = this.config.get<string>('CLOSE_ALL_PREVIEW_SECRET') ?? this.config.get<string>('JWT_SECRET');
    if (configured) return configured;
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new Error('CLOSE_ALL_PREVIEW_SECRET (or JWT_SECRET) must be configured');
    }
    // Dev/test only: tokens are valid for this process lifetime.
    this.ephemeralSecret ??= randomBytes(32).toString('hex');
    return this.ephemeralSecret;
  }

  /** Read-only: never writes, never executes. */
  async preview(userId: string, actor?: CloseAllActor, now = new Date()): Promise<CloseAllPreview> {
    if (actor) assertOwnership({ requesterId: actor.id, ownerId: userId, requesterRoles: actor.roles, resource: 'positions' });

    const snapshot = await this.buildSnapshot(userId);
    const previewId = randomUUID();
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
    const payload: CloseAllPreviewTokenPayload = {
      v: 1,
      pid: previewId,
      uid: userId,
      iat: now.getTime(),
      exp: expiresAt.getTime(),
      fp: snapshot.fingerprint,
      pos: Object.fromEntries(snapshot.eligible.map((p) => [p.positionId, [p.version, Number(p.estimatedExitPrice)]])),
    };

    return {
      previewId,
      userId,
      generatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      previewToken: signPreviewToken(payload, this.secret),
      fingerprint: snapshot.fingerprint,
      eligible: snapshot.eligible,
      ineligible: snapshot.ineligible,
      totals: this.totals(snapshot.eligible),
      estimatedNetworkFeeXlm: fx(snapshot.eligible.length * this.networkFeePerCloseXlm),
      assumptions: {
        maxPriceDriftBps: this.maxPriceDriftBps,
        platformFeeBps: this.platformFeeBps,
        networkFeePerCloseXlm: fx(this.networkFeePerCloseXlm),
        ttlSeconds: this.ttlSeconds,
      },
    };
  }

  async confirm(
    userId: string,
    previewToken: string,
    actor?: CloseAllActor,
    now = new Date(),
  ): Promise<CloseAllConfirmationResult> {
    if (actor) assertOwnership({ requesterId: actor.id, ownerId: userId, requesterRoles: actor.roles, resource: 'positions' });

    const payload = verifyPreviewToken(previewToken, this.secret);
    if (!payload) throw new BadRequestException({ code: 'CLOSE_ALL_PREVIEW_INVALID', message: 'Invalid preview token' });
    if (payload.uid !== userId) throw new ForbiddenException('Preview belongs to another user');

    // Idempotent replay — checked before expiry so a retried request after a
    // successful confirm still gets its original result.
    const existing = await this.confirmationRepo.findOne({ where: { previewId: payload.pid } });
    if (existing) return this.toResult(existing, true);

    if (now.getTime() > payload.exp) {
      throw new GoneException({
        code: 'CLOSE_ALL_PREVIEW_EXPIRED',
        message: 'Preview expired; request a new preview',
        expiredAt: new Date(payload.exp).toISOString(),
      });
    }

    const current = await this.buildSnapshot(userId);
    this.assertNotMateriallyChanged(payload, current);
    if (current.eligible.length === 0) {
      throw new BadRequestException({ code: 'CLOSE_ALL_NOTHING_TO_CLOSE', message: 'No eligible positions to close' });
    }

    let confirmation: CloseAllConfirmation;
    try {
      confirmation = this.confirmationRepo.create({
        userId,
        previewId: payload.pid,
        fingerprint: payload.fp,
        status: 'executing',
        positions: current.eligible.map((p) => [p.positionId, p.version] as [string, number]),
        results: [],
      });
      await this.confirmationRepo.insert(confirmation);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.confirmationRepo.findOne({ where: { previewId: payload.pid } });
        if (winner) return this.toResult(winner, true);
      }
      throw error;
    }

    const results: CloseAllPositionResult[] = [];
    for (const position of current.eligible) {
      try {
        const outcome = await this.closer.close({ tradeId: position.positionId, userId, version: position.version });
        results.push({ positionId: position.positionId, status: 'closed', ...outcome });
      } catch (error) {
        const message = (error as any)?.response?.message ?? (error as Error)?.message ?? 'Close failed';
        results.push({ positionId: position.positionId, status: 'failed', error: String(message) });
      }
    }

    confirmation.results = results;
    confirmation.status = results.some((r) => r.status === 'failed') ? 'completed_with_failures' : 'completed';
    confirmation.completedAt = new Date();
    await this.confirmationRepo.update(
      { id: confirmation.id },
      { results: confirmation.results, status: confirmation.status, completedAt: confirmation.completedAt },
    );
    this.logger.log(
      `Close-all ${payload.pid} for user ${userId}: ${results.filter((r) => r.status === 'closed').length}/${results.length} closed`,
    );
    return this.toResult(confirmation, false);
  }

  private assertNotMateriallyChanged(payload: CloseAllPreviewTokenPayload, current: PortfolioSnapshot): void {
    const previewed = payload.pos ?? {};
    const currentById = new Map(current.eligible.map((p) => [p.positionId, p]));
    const added = [...currentById.keys()].filter((id) => !(id in previewed));
    const removed = Object.keys(previewed).filter((id) => !currentById.has(id));
    const modified = Object.entries(previewed)
      .filter(([id, [version]]) => currentById.has(id) && currentById.get(id)!.version !== version)
      .map(([id]) => id);

    if (current.fingerprint !== payload.fp || added.length || removed.length || modified.length) {
      throw new ConflictException({
        code: 'CLOSE_ALL_PREVIEW_STALE',
        reason: 'positions_changed',
        message: 'Positions changed since the preview; request a new preview',
        added,
        removed,
        modified,
      });
    }

    const moved = Object.entries(previewed)
      .map(([id, [, price]]) => {
        const now = Number(currentById.get(id)!.estimatedExitPrice);
        return { positionId: id, previewPrice: price, currentPrice: now, driftBps: slippageBps(price, now) };
      })
      .filter((m) => m.driftBps > this.maxPriceDriftBps);
    if (moved.length) {
      throw new ConflictException({
        code: 'CLOSE_ALL_PREVIEW_STALE',
        reason: 'price_moved',
        message: `Estimated exit price moved more than ${this.maxPriceDriftBps} bps; request a new preview`,
        positions: moved,
      });
    }
  }

  /** Reads open positions and live quotes. Strictly read-only. */
  private async buildSnapshot(userId: string): Promise<PortfolioSnapshot> {
    const open = await this.tradeRepo.find({
      where: { userId, closedAt: IsNull(), status: In(OPEN_POSITION_STATUSES) },
      order: { createdAt: 'ASC' },
    });

    const eligible: EligiblePositionEstimate[] = [];
    const ineligible: IneligiblePosition[] = [];
    for (const trade of open) {
      const amount = Number(trade.amount);
      const base = {
        positionId: trade.id,
        side: trade.side,
        baseAsset: trade.baseAsset,
        counterAsset: trade.counterAsset,
        status: trade.status,
        amount: trade.amount,
      };
      if (!CLOSEABLE_STATUSES.includes(trade.status)) {
        const pending = PENDING_STATUSES.includes(trade.status);
        ineligible.push({
          ...base,
          reason: pending ? IneligibleReason.PENDING_SETTLEMENT : IneligibleReason.UNSUPPORTED_STATUS,
          detail: pending ? `Position is ${trade.status} and not yet settled` : `Positions in status ${trade.status} cannot be closed`,
        });
        continue;
      }
      if (!(amount > 0)) {
        ineligible.push({ ...base, reason: IneligibleReason.ZERO_QUANTITY, detail: 'Nothing left to close' });
        continue;
      }

      let quote = null;
      try {
        quote = await this.quotes.quote({
          baseAsset: trade.baseAsset,
          counterAsset: trade.counterAsset,
          direction: trade.side === TradeSide.BUY ? 'sell_base' : 'buy_base',
          amount,
        });
      } catch (error) {
        this.logger.warn(`Quote for position ${trade.id} failed: ${(error as Error).message}`);
      }
      if (!quote) {
        ineligible.push({ ...base, reason: IneligibleReason.PRICE_UNAVAILABLE, detail: 'No market quote available' });
        continue;
      }
      if (!quote.sufficientLiquidity) {
        ineligible.push({
          ...base,
          reason: IneligibleReason.INSUFFICIENT_LIQUIDITY,
          detail: 'Visible order book depth does not cover the position size',
        });
        continue;
      }

      const exit = quote.averagePrice;
      const entry = Number(trade.entryPrice);
      const notional = amount * exit;
      const platformFee = (notional * this.platformFeeBps) / 10_000;
      const grossPnl = trade.side === TradeSide.BUY ? (exit - entry) * amount : (entry - exit) * amount;
      eligible.push({
        ...base,
        version: trade.version ?? 1,
        entryPrice: trade.entryPrice,
        estimatedExitPrice: fx(exit),
        bestPrice: fx(quote.bestPrice),
        estimatedSlippageBps: slippageBps(quote.bestPrice, exit),
        estimatedSlippageCost: fx(Math.abs(quote.bestPrice - exit) * amount),
        estimatedNotional: fx(notional),
        estimatedPlatformFee: fx(platformFee),
        estimatedNetworkFeeXlm: fx(this.networkFeePerCloseXlm),
        estimatedRealizedPnl: fx(grossPnl - platformFee),
        quoteSource: quote.source,
      });
    }

    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          e: eligible.map((p) => [p.positionId, p.version, p.status, p.amount, p.side]).sort(),
          i: ineligible.map((p) => [p.positionId, p.reason]).sort(),
        }),
      )
      .digest('hex');
    return { eligible, ineligible, fingerprint };
  }

  private totals(eligible: EligiblePositionEstimate[]): CloseAllTotals[] {
    const byCounter = new Map<string, EligiblePositionEstimate[]>();
    for (const p of eligible) byCounter.set(p.counterAsset, [...(byCounter.get(p.counterAsset) ?? []), p]);
    const sum = (list: EligiblePositionEstimate[], k: keyof EligiblePositionEstimate) =>
      fx(list.reduce((acc, p) => acc + Number(p[k]), 0));
    return [...byCounter.entries()].map(([counterAsset, list]) => ({
      counterAsset,
      positions: list.length,
      estimatedNotional: sum(list, 'estimatedNotional'),
      estimatedSlippageCost: sum(list, 'estimatedSlippageCost'),
      estimatedPlatformFee: sum(list, 'estimatedPlatformFee'),
      estimatedRealizedPnl: sum(list, 'estimatedRealizedPnl'),
    }));
  }

  private toResult(row: CloseAllConfirmation, replayed: boolean): CloseAllConfirmationResult {
    const results = row.results ?? [];
    return {
      confirmationId: row.id,
      previewId: row.previewId,
      status: row.status,
      replayed,
      requested: row.positions?.length ?? results.length,
      closed: results.filter((r) => r.status === 'closed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
      confirmedAt: new Date(row.createdAt ?? Date.now()).toISOString(),
      completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    };
  }
}
