import { Injectable } from '@nestjs/common';
import { Trade, TradeSide, TradeStatus } from '../../trades/entities/trade.entity';

export interface PnlAttribution {
  realizedPnL: number;
  unrealizedPnL: number;
  totalFees: number;
}

export interface PortfolioPnlResult {
  realizedPnL: number;
  unrealizedPnL: number;
  totalFees: number;
  bySignal: Record<string, PnlAttribution>;
  byAsset: Record<string, PnlAttribution>;
  missingPrices: string[];
}

interface PnlEvent {
  assetSymbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  fee: number;
  signalId: string | null;
  timestamp: Date;
  type: 'entry' | 'exit';
}

interface PnlLot {
  assetSymbol: string;
  side: TradeSide;
  quantityRemaining: number;
  entryPrice: number;
  entryFeeRemaining: number;
  signalId: string | null;
}

@Injectable()
export class PnlCalculatorService {
  calculateUnrealizedPnL(trade: Trade, currentPrice: number): number {
    const amount = Number(trade.amount);
    const entryPrice = Number(trade.entryPrice);
    const entryFee = this.getEntryFee(trade);

    if (trade.side === TradeSide.BUY) {
      return (currentPrice - entryPrice) * amount - entryFee;
    }

    return (entryPrice - currentPrice) * amount - entryFee;
  }

  calculatePortfolioPnl(trades: Trade[], currentPrices: Record<string, number>): PortfolioPnlResult {
    const events = this.buildEventsFromTrades(trades);
    const lotsByAsset = new Map<string, { [TradeSide.BUY]: PnlLot[]; [TradeSide.SELL]: PnlLot[] }>();
    const result: PortfolioPnlResult = {
      realizedPnL: 0,
      unrealizedPnL: 0,
      totalFees: 0,
      bySignal: {},
      byAsset: {},
      missingPrices: [],
    };

    const sortedEvents = events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    for (const event of sortedEvents) {
      const lots = this.getLotsForAsset(lotsByAsset, event.assetSymbol);

      if (event.type === 'entry') {
        lots[event.side].push({
          assetSymbol: event.assetSymbol,
          side: event.side,
          quantityRemaining: event.quantity,
          entryPrice: event.price,
          entryFeeRemaining: event.fee,
          signalId: event.signalId,
        });
        continue;
      }

      const entrySide = event.side === TradeSide.BUY ? TradeSide.SELL : TradeSide.BUY;
      let remainingQty = event.quantity;
      let remainingExitFee = event.fee;

      while (remainingQty > 0 && lots[entrySide].length > 0) {
        const lot = lots[entrySide][0];
        const matchQty = Math.min(remainingQty, lot.quantityRemaining);
        const entryFeeShare = lot.entryFeeRemaining * (matchQty / lot.quantityRemaining);
        const exitFeeShare = remainingExitFee * (matchQty / remainingQty);

        const realizedPnL = this.calculateRealizedPnL(
          entrySide,
          lot.entryPrice,
          event.price,
          matchQty,
          entryFeeShare,
          exitFeeShare,
        );

        this.applyAttribution(result.byAsset, lot.assetSymbol, realizedPnL, 0, entryFeeShare + exitFeeShare);
        if (lot.signalId) {
          this.applyAttribution(result.bySignal, lot.signalId, realizedPnL, 0, entryFeeShare + exitFeeShare);
        }

        result.realizedPnL += realizedPnL;
        result.totalFees += entryFeeShare + exitFeeShare;

        lot.quantityRemaining -= matchQty;
        lot.entryFeeRemaining -= entryFeeShare;
        remainingQty -= matchQty;
        remainingExitFee -= exitFeeShare;

        if (lot.quantityRemaining <= 0) {
          lots[entrySide].shift();
        }
      }
    }

    for (const [assetSymbol, lots] of lotsByAsset.entries()) {
      const currentPrice = currentPrices[assetSymbol];
      if (!currentPrice) {
        if (!result.missingPrices.includes(assetSymbol)) {
          result.missingPrices.push(assetSymbol);
        }
        continue;
      }

      const openLots = [...lots[TradeSide.BUY], ...lots[TradeSide.SELL]];
      for (const lot of openLots) {
        const unrealizedPnL = this.calculateUnrealizedForLot(lot, currentPrice);

        this.applyAttribution(result.byAsset, assetSymbol, 0, unrealizedPnL, lot.entryFeeRemaining);
        if (lot.signalId) {
          this.applyAttribution(result.bySignal, lot.signalId, 0, unrealizedPnL, lot.entryFeeRemaining);
        }

        result.unrealizedPnL += unrealizedPnL;
        result.totalFees += lot.entryFeeRemaining;
      }
    }

    return result;
  }

  private buildEventsFromTrades(trades: Trade[]): PnlEvent[] {
    const events: PnlEvent[] = [];

    for (const trade of trades) {
      const assetSymbol = `${trade.baseAsset}/${trade.counterAsset}`;
      const entryTimestamp = trade.executedAt || trade.createdAt;
      const entryFee = this.getEntryFee(trade);
      const amount = Number(trade.amount);

      events.push({
        assetSymbol,
        side: trade.side,
        quantity: amount,
        price: Number(trade.entryPrice),
        fee: entryFee,
        signalId: trade.signalId ?? null,
        timestamp: entryTimestamp,
        type: 'entry',
      });

      if (trade.status === TradeStatus.COMPLETED && trade.exitPrice) {
        const exitFee = this.getExitFee(trade);
        const exitTimestamp = trade.closedAt || trade.updatedAt;
        const exitSide = trade.side === TradeSide.BUY ? TradeSide.SELL : TradeSide.BUY;

        events.push({
          assetSymbol,
          side: exitSide,
          quantity: amount,
          price: Number(trade.exitPrice),
          fee: exitFee,
          signalId: trade.signalId ?? null,
          timestamp: exitTimestamp,
          type: 'exit',
        });
      }
    }

    return events;
  }

  private getLotsForAsset(
    lotsByAsset: Map<string, { [TradeSide.BUY]: PnlLot[]; [TradeSide.SELL]: PnlLot[] }>,
    assetSymbol: string,
  ) {
    if (!lotsByAsset.has(assetSymbol)) {
      lotsByAsset.set(assetSymbol, {
        [TradeSide.BUY]: [],
        [TradeSide.SELL]: [],
      });
    }

    return lotsByAsset.get(assetSymbol)!;
  }

  private calculateRealizedPnL(
    entrySide: TradeSide,
    entryPrice: number,
    exitPrice: number,
    quantity: number,
    entryFee: number,
    exitFee: number,
  ): number {
    if (entrySide === TradeSide.BUY) {
      const entryCost = entryPrice * quantity + entryFee;
      const exitProceeds = exitPrice * quantity - exitFee;
      return exitProceeds - entryCost;
    }

    const entryProceeds = entryPrice * quantity - entryFee;
    const exitCost = exitPrice * quantity + exitFee;
    return entryProceeds - exitCost;
  }

  private calculateUnrealizedForLot(lot: PnlLot, currentPrice: number): number {
    if (lot.side === TradeSide.BUY) {
      return (currentPrice - lot.entryPrice) * lot.quantityRemaining - lot.entryFeeRemaining;
    }

    return (lot.entryPrice - currentPrice) * lot.quantityRemaining - lot.entryFeeRemaining;
  }

  private getEntryFee(trade: Trade): number {
    return Number(trade.feeAmount || 0);
  }

  private getExitFee(trade: Trade): number {
    if (trade.metadata && typeof trade.metadata['exitFee'] === 'number') {
      return Number(trade.metadata['exitFee']);
    }
    if (trade.metadata && typeof trade.metadata['exit_fee'] === 'number') {
      return Number(trade.metadata['exit_fee']);
    }
    return 0;
  }

  private applyAttribution(
    target: Record<string, PnlAttribution>,
    key: string,
    realizedPnL: number,
    unrealizedPnL: number,
    totalFees: number,
  ) {
    if (!target[key]) {
      target[key] = { realizedPnL: 0, unrealizedPnL: 0, totalFees: 0 };
    }

    target[key].realizedPnL += realizedPnL;
    target[key].unrealizedPnL += unrealizedPnL;
    target[key].totalFees += totalFees;
  }
}
