import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Trade } from '../../trades/entities/trade.entity';

@Injectable()
export class TradeReportExporterService {
  constructor(@InjectRepository(Trade) private tradeRepo: Repository<Trade>) {}

  async generateTradeVolumeReport(startDate: Date, endDate: Date): Promise<any> {
    const trades = await this.tradeRepo.find({
      where: { createdAt: Between(startDate, endDate) },
    });

    const totalVolume = trades.reduce((sum, t) => sum + parseFloat(t.amount) * parseFloat(t.price), 0);
    const uniqueUsers = new Set(trades.map((t) => t.userId)).size;

    const assetVolumes = trades.reduce((acc, t) => {
      const pair = `${t.baseAsset}/${t.quoteAsset}`;
      acc[pair] = (acc[pair] || 0) + parseFloat(t.amount) * parseFloat(t.price);
      return acc;
    }, {} as Record<string, number>);

    const topAssets = Object.entries(assetVolumes)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([asset, volume]) => ({ asset, volume }));

    return {
      period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
      totalTrades: trades.length,
      totalVolume,
      uniqueUsers,
      topAssets,
      generatedAt: new Date().toISOString(),
    };
  }

  async generateFinancialSummary(startDate: Date, endDate: Date): Promise<any> {
    const trades = await this.tradeRepo.find({
      where: { createdAt: Between(startDate, endDate), status: 'closed' },
    });

    const totalPnL = trades.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0);
    const profitableTrades = trades.filter((t) => parseFloat(t.pnl || '0') > 0).length;
    const winRate = trades.length > 0 ? (profitableTrades / trades.length) * 100 : 0;

    return {
      period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
      totalTrades: trades.length,
      profitableTrades,
      losingTrades: trades.length - profitableTrades,
      winRate: winRate.toFixed(2),
      totalPnL: totalPnL.toFixed(2),
      averagePnL: trades.length > 0 ? (totalPnL / trades.length).toFixed(2) : '0',
      generatedAt: new Date().toISOString(),
    };
  }
}
