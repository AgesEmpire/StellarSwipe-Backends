import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Asset } from '@stellar/stellar-sdk';
import { Signal, SignalStatus } from '../signals/entities/signal.entity';
import { Trade, TradeStatus, TradeSide } from './entities/trade.entity';
import { SdexService } from '../sdex/sdex.service';
import { SorobanService } from '../soroban/soroban.service';
import { ConfigService } from '@nestjs/config';
import { PlaceLimitOrderDto, LimitOrderStatusDto } from './dto/limit-order.dto';

const PRICE_STALENESS_MS = 60_000; // reject if market data older than 60 s

@Injectable()
export class LimitOrderService {
  private readonly logger = new Logger(LimitOrderService.name);

  constructor(
    @InjectRepository(Signal) private readonly signalRepo: Repository<Signal>,
    @InjectRepository(Trade) private readonly tradeRepo: Repository<Trade>,
    private readonly sdex: SdexService,
    private readonly soroban: SorobanService,
    private readonly config: ConfigService,
  ) {}

  async place(dto: PlaceLimitOrderDto): Promise<LimitOrderStatusDto> {
    // 1. Load & validate signal
    const signal = await this.signalRepo.findOneBy({ id: dto.signalId });
    if (!signal) throw new NotFoundException('Signal not found');
    if (signal.status !== SignalStatus.ACTIVE) {
      throw new BadRequestException('Signal is no longer active');
    }
    if (signal.expiresAt < new Date()) {
      throw new BadRequestException('Signal has expired');
    }

    // 2. Fetch live market price from SDEX
    const sellingAsset = this.parseAsset(signal.baseAsset);
    const buyingAsset = this.parseAsset(signal.counterAsset);
    const orderbook = await this.sdex.getOrderbook(sellingAsset, buyingAsset);

    // Guard against stale orderbook data
    const dataAge = Date.now() - new Date(orderbook.lastUpdate).getTime();
    if (dataAge > PRICE_STALENESS_MS) {
      throw new BadRequestException('Market data is stale; please retry');
    }

    const marketPrice = parseFloat(orderbook.midPrice);
    if (marketPrice <= 0) {
      throw new BadRequestException('Unable to determine market price');
    }

    // 3. Validate limit price against market
    this.validateLimitPrice(dto.side, dto.limitPrice, marketPrice, dto.slippageTolerance ?? 1);

    // 4. Persist trade record as PENDING
    const trade = this.tradeRepo.create({
      userId: dto.userId,
      signalId: dto.signalId,
      side: dto.side,
      baseAsset: signal.baseAsset,
      counterAsset: signal.counterAsset,
      entryPrice: dto.limitPrice.toFixed(8),
      amount: dto.amount.toFixed(8),
      totalValue: (dto.amount * dto.limitPrice).toFixed(8),
      status: TradeStatus.PENDING,
      metadata: { orderType: 'limit', limitPrice: dto.limitPrice, marketPrice },
    });
    await this.tradeRepo.save(trade);

    // 5. Submit Soroban limit order contract call
    const contractId = this.config.get<string>('stellar.limitOrderContractId', '');
    if (!contractId) {
      this.logger.warn('No limitOrderContractId configured; skipping Soroban submission');
      return this.buildStatus(trade, 'pending');
    }

    const sourceSecret = this.config.get<string>('stellar.operatorSecret');
    if (!sourceSecret) {
      throw new BadRequestException('Operator wallet not configured');
    }

    try {
      const result = await this.soroban.invokeContract(
        contractId,
        'place_limit_order',
        [
          trade.id,
          dto.userId,
          signal.baseAsset,
          signal.counterAsset,
          dto.side,
          dto.amount.toFixed(8),
          dto.limitPrice.toFixed(8),
        ],
        { sourceSecret },
      );

      if (result.success) {
        trade.status = TradeStatus.CONFIRMED;
        trade.transactionHash = result.hash;
        trade.sorobanContractId = contractId;
        trade.feeAmount = result.feeCharged ?? '0';
        await this.tradeRepo.save(trade);
        return this.buildStatus(trade, 'pending', result.hash);
      } else {
        trade.status = TradeStatus.FAILED;
        trade.errorMessage = result.error;
        await this.tradeRepo.save(trade);
        throw new BadRequestException(`Soroban contract call failed: ${result.error}`);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      trade.status = TradeStatus.FAILED;
      trade.errorMessage = msg;
      await this.tradeRepo.save(trade);
      throw new BadRequestException(`Limit order submission failed: ${msg}`);
    }
  }

  async getStatus(tradeId: string, userId: string): Promise<LimitOrderStatusDto> {
    const trade = await this.tradeRepo.findOne({ where: { id: tradeId, userId } });
    if (!trade) throw new NotFoundException('Limit order not found');

    const status = this.mapTradeStatusToOrderStatus(trade);
    return this.buildStatus(trade, status, trade.transactionHash);
  }

  private validateLimitPrice(
    side: TradeSide,
    limitPrice: number,
    marketPrice: number,
    slippagePct: number,
  ): void {
    const tolerance = marketPrice * (slippagePct / 100);

    if (side === TradeSide.BUY && limitPrice > marketPrice + tolerance) {
      throw new BadRequestException(
        `Limit price ${limitPrice} exceeds market price ${marketPrice} by more than ${slippagePct}%`,
      );
    }

    if (side === TradeSide.SELL && limitPrice < marketPrice - tolerance) {
      throw new BadRequestException(
        `Limit price ${limitPrice} is below market price ${marketPrice} by more than ${slippagePct}%`,
      );
    }
  }

  private parseAsset(assetStr: string): Asset {
    if (assetStr.toUpperCase() === 'XLM' || assetStr.toUpperCase() === 'NATIVE') {
      return Asset.native();
    }
    const [code, issuer] = assetStr.split(':');
    if (!issuer) throw new BadRequestException(`Invalid asset format: ${assetStr}`);
    return new Asset(code, issuer);
  }

  private mapTradeStatusToOrderStatus(
    trade: Trade,
  ): 'pending' | 'filled' | 'rejected' | 'expired' {
    switch (trade.status) {
      case TradeStatus.COMPLETED:
      case TradeStatus.SETTLED:
        return 'filled';
      case TradeStatus.FAILED:
      case TradeStatus.CANCELLED:
        return 'rejected';
      default:
        return 'pending';
    }
  }

  private buildStatus(
    trade: Trade,
    status: 'pending' | 'filled' | 'rejected' | 'expired',
    txHash?: string,
  ): LimitOrderStatusDto {
    return {
      id: trade.id,
      status,
      transactionHash: txHash,
      executedPrice: trade.entryPrice,
      feeAmount: trade.feeAmount,
      error: trade.errorMessage,
      createdAt: trade.createdAt,
    };
  }
}
