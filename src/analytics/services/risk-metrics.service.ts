import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Trade, TradeStatus } from '../../trades/entities/trade.entity';
import { StatisticalAnalysisService } from './statistical-analysis.service';
import { RiskMetricsResponseDto } from '../dto/risk-metrics.dto';
import { PriceService } from '../../shared/price.service';

interface DailyPortfolioValue {
  date: Date;
  value: number;
  return: number;
}

@Injectable()
export class RiskMetricsService {
  private readonly RISK_FREE_RATE = 0.04; // 4% annual risk-free rate
  private readonly TRADING_DAYS_PER_YEAR = 365;
  private readonly MIN_DATA_POINTS = 30;

  constructor(
    @InjectRepository(Trade)
    private tradeRepository: Repository<Trade>,
    private statisticalService: StatisticalAnalysisService,
    private priceService: PriceService,
  ) {}

  async calculateRiskMetrics(userId: string, days: number = 90): Promise<RiskMetricsResponseDto> {
    if (days < this.MIN_DATA_POINTS) {
      throw new BadRequestException(`Minimum ${this.MIN_DATA_POINTS} days of data required`);
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const trades = await this.tradeRepository.find({
      where: {
        userId,
        createdAt: Between(startDate, endDate),
      },
      order: { createdAt: 'ASC' },
    });

    if (trades.length === 0) {
      throw new BadRequestException('Insufficient trade data for risk analysis');
    }

    const dailyValues = await this.calculateDailyPortfolioValues(trades, startDate, endDate);

    if (dailyValues.length < this.MIN_DATA_POINTS) {
      throw new BadRequestException(`Insufficient data points. Found ${dailyValues.length}, need ${this.MIN_DATA_POINTS}`);
    }

    const dailyReturns = dailyValues.map(d => d.return).filter(r => !isNaN(r) && isFinite(r));

    if (dailyReturns.length < this.MIN_DATA_POINTS) {
      throw new BadRequestException('Insufficient return data for calculations');
    }

    const sharpeRatio = this.calculateSharpeRatio(dailyReturns);
    const { maxDrawdown, currentDrawdown } = this.calculateDrawdowns(dailyValues);
    const volatility = this.calculateVolatility(dailyReturns);
    const valueAtRisk95 = this.calculateVaR(dailyReturns, dailyValues[dailyValues.length - 1].value);
    const beta = await this.calculateBeta(dailyReturns, startDate, endDate);

    return {
      sharpeRatio,
      maxDrawdown,
      currentDrawdown,
      volatility,
      valueAtRisk95,
      beta,
      calculationPeriod: {
        start: startDate,
        end: endDate,
      },
    };
  }

  private async calculateDailyPortfolioValues(
    trades: Trade[],
    startDate: Date,
    endDate: Date,
  ): Promise<DailyPortfolioValue[]> {
    const dailyValues: DailyPortfolioValue[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dayTrades = trades.filter(t => new Date(t.createdAt) <= currentDate);
      
      if (dayTrades.length > 0) {
        const value = await this.calculatePortfolioValueAtDate(dayTrades, currentDate);
        const previousValue = dailyValues.length > 0 ? dailyValues[dailyValues.length - 1].value : value;
        const dailyReturn = previousValue > 0 ? (value - previousValue) / previousValue : 0;

        dailyValues.push({
          date: new Date(currentDate),
          value,
          return: dailyReturn,
        });
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dailyValues;
  }

  private async calculatePortfolioValueAtDate(trades: Trade[], date: Date): Promise<number> {
    let totalValue = 0;

    const openTrades = trades.filter(t => 
      t.status === TradeStatus.EXECUTING || 
      t.status === TradeStatus.PENDING ||
      (t.status === TradeStatus.COMPLETED && (!t.closedAt || new Date(t.closedAt) > date))
    );

    for (const trade of openTrades) {
      const value = Number(trade.amount) * Number(trade.entryPrice);
      totalValue += value;
    }

    const completedTrades = trades.filter(t => 
      t.status === TradeStatus.COMPLETED && 
      t.closedAt && 
      new Date(t.closedAt) <= date
    );

    for (const trade of completedTrades) {
      totalValue += Number(trade.profitLoss || 0);
    }

    return totalValue;
  }

  private calculateSharpeRatio(dailyReturns: number[]): number {
    const avgDailyReturn = this.statisticalService.calculateMean(dailyReturns);
    const stdDev = this.statisticalService.calculateStandardDeviation(dailyReturns);

    if (stdDev === 0) return 0;

    const annualizedReturn = avgDailyReturn * this.TRADING_DAYS_PER_YEAR;
    const annualizedStdDev = stdDev * Math.sqrt(this.TRADING_DAYS_PER_YEAR);

    return (annualizedReturn - this.RISK_FREE_RATE) / annualizedStdDev;
  }

  private calculateDrawdowns(dailyValues: DailyPortfolioValue[]): { maxDrawdown: number; currentDrawdown: number } {
    let maxDrawdown = 0;
    let peak = dailyValues[0].value;
    let currentDrawdown = 0;

    for (const day of dailyValues) {
      if (day.value > peak) {
        peak = day.value;
      }

      const drawdown = peak > 0 ? ((day.value - peak) / peak) * 100 : 0;
      
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    const currentValue = dailyValues[dailyValues.length - 1].value;
    const currentPeak = Math.max(...dailyValues.map(d => d.value));
    currentDrawdown = currentPeak > 0 ? ((currentValue - currentPeak) / currentPeak) * 100 : 0;

    return { maxDrawdown: Math.abs(maxDrawdown), currentDrawdown: Math.abs(currentDrawdown) };
  }

  private calculateVolatility(dailyReturns: number[]): number {
    const stdDev = this.statisticalService.calculateStandardDeviation(dailyReturns);
    return stdDev * Math.sqrt(this.TRADING_DAYS_PER_YEAR) * 100;
  }

  private calculateVaR(dailyReturns: number[], currentValue: number): number {
    const var95 = this.statisticalService.calculatePercentile(dailyReturns, 5);
    return Math.abs(var95 * currentValue);
  }

  private async calculateBeta(
    portfolioReturns: number[],
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    try {
      const xlmReturns = await this.getXLMBenchmarkReturns(startDate, endDate);
      
      if (xlmReturns.length !== portfolioReturns.length) {
        return 1.0;
      }

      const covariance = this.statisticalService.calculateCovariance(portfolioReturns, xlmReturns);
      const marketVariance = Math.pow(this.statisticalService.calculateStandardDeviation(xlmReturns), 2);

      if (marketVariance === 0) return 1.0;

      return covariance / marketVariance;
    } catch {
      return 1.0;
    }
  }

  private async getXLMBenchmarkReturns(startDate: Date, endDate: Date): Promise<number[]> {
    const returns: number[] = [];
    const currentDate = new Date(startDate);
    let previousPrice: number | null = null;

    while (currentDate <= endDate) {
      try {
        const prices = await this.priceService.getMultiplePrices(['XLM/USDC']);
        const currentPrice = prices['XLM/USDC'];

        if (currentPrice && previousPrice) {
          const dailyReturn = (currentPrice - previousPrice) / previousPrice;
          returns.push(dailyReturn);
        }

        previousPrice = currentPrice || previousPrice;
      } catch {
        if (previousPrice) {
          returns.push(0);
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return returns;
  }
}
