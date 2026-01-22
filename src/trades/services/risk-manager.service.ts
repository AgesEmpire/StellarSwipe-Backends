import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Trade, TradeStatus } from '../entities/trade.entity';
import { ExecuteTradeDto } from '../dto/execute-trade.dto';
import { TradeValidationResultDto } from '../dto/trade-result.dto';

export interface RiskParameters {
  maxOpenPositions: number;
  maxPositionSize: number;
  minPositionSize: number;
  maxDailyTrades: number;
  maxDailyVolume: number;
  defaultSlippageTolerance: number;
  maxSlippageTolerance: number;
  baseFeePercentage: number;
}

export interface UserBalance {
  available: string;
  locked: string;
  total: string;
}

@Injectable()
export class RiskManagerService {
  private readonly riskParams: RiskParameters;

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    private readonly configService: ConfigService,
  ) {
    this.riskParams = {
      maxOpenPositions: this.configService.get<number>('trade.maxOpenPositions', 10),
      maxPositionSize: this.configService.get<number>('trade.maxPositionSize', 100000),
      minPositionSize: this.configService.get<number>('trade.minPositionSize', 1),
      maxDailyTrades: this.configService.get<number>('trade.maxDailyTrades', 50),
      maxDailyVolume: this.configService.get<number>('trade.maxDailyVolume', 1000000),
      defaultSlippageTolerance: this.configService.get<number>('trade.defaultSlippageTolerance', 0.5),
      maxSlippageTolerance: this.configService.get<number>('trade.maxSlippageTolerance', 5),
      baseFeePercentage: this.configService.get<number>('trade.baseFeePercentage', 0.1),
    };
  }

  async validateTrade(
    dto: ExecuteTradeDto,
    signalData: { entryPrice: string; status: string; expiresAt: Date },
    userBalance: UserBalance,
  ): Promise<TradeValidationResultDto> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check signal status
    if (signalData.status !== 'active') {
      errors.push(`Signal is not active. Current status: ${signalData.status}`);
    }

    // Check signal expiration
    if (new Date(signalData.expiresAt) < new Date()) {
      errors.push('Signal has expired');
    }

    // Check position size limits
    if (dto.amount < this.riskParams.minPositionSize) {
      errors.push(`Amount is below minimum position size of ${this.riskParams.minPositionSize}`);
    }

    if (dto.amount > this.riskParams.maxPositionSize) {
      errors.push(`Amount exceeds maximum position size of ${this.riskParams.maxPositionSize}`);
    }

    // Check open positions limit
    const openPositions = await this.countOpenPositions(dto.userId);
    if (openPositions >= this.riskParams.maxOpenPositions) {
      errors.push(`Maximum open positions limit reached (${this.riskParams.maxOpenPositions})`);
    }

    // Check daily trade limit
    const dailyTrades = await this.countDailyTrades(dto.userId);
    if (dailyTrades >= this.riskParams.maxDailyTrades) {
      errors.push(`Maximum daily trades limit reached (${this.riskParams.maxDailyTrades})`);
    }

    // Check daily volume limit
    const dailyVolume = await this.getDailyVolume(dto.userId);
    const entryPrice = parseFloat(signalData.entryPrice);
    const tradeValue = dto.amount * entryPrice;
    if (dailyVolume + tradeValue > this.riskParams.maxDailyVolume) {
      errors.push(`Trade would exceed daily volume limit of ${this.riskParams.maxDailyVolume}`);
    }

    // Calculate fees and total cost
    const feeAmount = tradeValue * (this.riskParams.baseFeePercentage / 100);
    const totalCost = tradeValue + feeAmount;

    // Check balance
    const availableBalance = parseFloat(userBalance.available);
    if (totalCost > availableBalance) {
      errors.push(`Insufficient balance. Required: ${totalCost.toFixed(8)}, Available: ${userBalance.available}`);
    }

    // Check slippage tolerance
    const slippage = dto.slippageTolerance ?? this.riskParams.defaultSlippageTolerance;
    if (slippage > this.riskParams.maxSlippageTolerance) {
      errors.push(`Slippage tolerance exceeds maximum of ${this.riskParams.maxSlippageTolerance}%`);
    }

    // Warnings
    if (openPositions >= this.riskParams.maxOpenPositions - 2) {
      warnings.push(`Approaching maximum open positions limit (${openPositions}/${this.riskParams.maxOpenPositions})`);
    }

    if (dailyTrades >= this.riskParams.maxDailyTrades - 5) {
      warnings.push(`Approaching daily trade limit (${dailyTrades}/${this.riskParams.maxDailyTrades})`);
    }

    const expirationTime = new Date(signalData.expiresAt).getTime() - Date.now();
    if (expirationTime < 300000) { // 5 minutes
      warnings.push('Signal is expiring soon');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      estimatedFee: feeAmount.toFixed(8),
      estimatedTotalCost: totalCost.toFixed(8),
    };
  }

  async countOpenPositions(userId: string): Promise<number> {
    return this.tradeRepository.count({
      where: {
        userId,
        status: TradeStatus.COMPLETED,
        closedAt: undefined,
      },
    });
  }

  async countDailyTrades(userId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.tradeRepository
      .createQueryBuilder('trade')
      .where('trade.user_id = :userId', { userId })
      .andWhere('trade.created_at >= :today', { today })
      .getCount();
  }

  async getDailyVolume(userId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await this.tradeRepository
      .createQueryBuilder('trade')
      .select('COALESCE(SUM(CAST(trade.total_value AS DECIMAL)), 0)', 'totalVolume')
      .where('trade.user_id = :userId', { userId })
      .andWhere('trade.created_at >= :today', { today })
      .getRawOne();

    return parseFloat(result?.totalVolume || '0');
  }

  calculateFee(tradeValue: number): string {
    const fee = tradeValue * (this.riskParams.baseFeePercentage / 100);
    return fee.toFixed(8);
  }

  calculateProfitLoss(
    entryPrice: string,
    exitPrice: string,
    amount: string,
    side: 'buy' | 'sell',
  ): { profitLoss: string; profitLossPercentage: string } {
    const entry = parseFloat(entryPrice);
    const exit = parseFloat(exitPrice);
    const qty = parseFloat(amount);

    let profitLoss: number;
    if (side === 'buy') {
      profitLoss = (exit - entry) * qty;
    } else {
      profitLoss = (entry - exit) * qty;
    }

    const profitLossPercentage = ((profitLoss / (entry * qty)) * 100);

    return {
      profitLoss: profitLoss.toFixed(8),
      profitLossPercentage: profitLossPercentage.toFixed(4),
    };
  }

  async checkDuplicateTrade(userId: string, signalId: string): Promise<boolean> {
    const existingTrade = await this.tradeRepository.findOne({
      where: {
        userId,
        signalId,
        status: TradeStatus.PENDING,
      },
    });

    return !!existingTrade;
  }

  getRiskParameters(): RiskParameters {
    return { ...this.riskParams };
  }
}
