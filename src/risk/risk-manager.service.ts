import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RiskSettings } from './entities/risk-settings.entity';
import { UpdateRiskSettingsDto } from './dto/risk-settings.dto';

export interface TradeDetails {
  userId: string;
  asset: string;
  amount: number;
  entryPrice: number;
  stopLossPrice?: number;
}

@Injectable()
export class RiskManagerService {
  constructor(
    @InjectRepository(RiskSettings)
    private readonly riskSettingsRepository: Repository<RiskSettings>,
  ) {}

  async getSettings(userId: string): Promise<RiskSettings> {
    let settings = await this.riskSettingsRepository.findOne({ where: { userId } });
    
    if (!settings) {
      // Create default settings if none exist
      settings = this.riskSettingsRepository.create({
        userId,
        maxOpenPositions: 10,
        maxExposurePercentage: 50,
        requireStopLoss: true,
        minStopLossPercentage: 5,
        maxStopLossPercentage: 20,
      });
      await this.riskSettingsRepository.save(settings);
    }
    
    return settings;
  }

  async updateSettings(userId: string, updateDto: UpdateRiskSettingsDto): Promise<RiskSettings> {
    let settings = await this.getSettings(userId);
    Object.assign(settings, updateDto);
    return await this.riskSettingsRepository.save(settings);
  }

  async validateTrade(trade: TradeDetails, currentOpenPositions: number, totalExposureAmount: number, userBalance: number): Promise<boolean> {
    const settings = await this.getSettings(trade.userId);

    // 1. Check open position count
    if (currentOpenPositions >= settings.maxOpenPositions) {
      throw new BadRequestException(`Maximum open positions reached (${settings.maxOpenPositions})`);
    }

    // 2. Stop-loss validation
    if (settings.requireStopLoss) {
      if (!trade.stopLossPrice) {
        throw new BadRequestException('Stop-loss is required for this trade');
      }

      const slPercent = Math.abs((trade.entryPrice - trade.stopLossPrice) / trade.entryPrice) * 100;
      if (slPercent < settings.minStopLossPercentage || slPercent > settings.maxStopLossPercentage) {
        throw new BadRequestException(
          `Stop-loss must be between ${settings.minStopLossPercentage}% and ${settings.maxStopLossPercentage}% (Current: ${slPercent.toFixed(2)}%)`,
        );
      }
    }

    // 3. Exposure validation
    const newExposure = totalExposureAmount + (trade.amount * trade.entryPrice);
    const maxExposureValue = userBalance * (settings.maxExposurePercentage / 100);
    
    if (newExposure > maxExposureValue) {
      throw new BadRequestException(
        `Total exposure would exceed limit of ${settings.maxExposurePercentage}% of balance (Max: ${maxExposureValue.toFixed(2)}, Projected: ${newExposure.toFixed(2)})`,
      );
    }

    // 4. Sufficient balance for potential loss
    if (trade.stopLossPrice) {
      const potentialLoss = (trade.entryPrice - trade.stopLossPrice) * trade.amount;
      if (potentialLoss > userBalance) {
        throw new BadRequestException('Insufficient balance to cover potential loss');
      }
    }

    return true;
  }
}
