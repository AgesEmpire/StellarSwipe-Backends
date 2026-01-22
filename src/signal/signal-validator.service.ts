import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CreateSignalDto, SignalAction } from '../dto/create-signal.dto';

@Injectable()
export class SignalValidatorService {
  private readonly SUPPORTED_ASSETS = [
    'USDC',
    'XLM',
    'BTC',
    'ETH',
    'USDT',
    'EURC',
  ];

  /**
   * Validates the asset pair format and supported assets
   */
  validateAssetPair(assetPair: string): void {
    const [base, quote] = assetPair.split('/');

    if (!this.SUPPORTED_ASSETS.includes(base)) {
      throw new BadRequestException(
        `Unsupported base asset: ${base}. Supported assets: ${this.SUPPORTED_ASSETS.join(', ')}`,
      );
    }

    if (!this.SUPPORTED_ASSETS.includes(quote)) {
      throw new BadRequestException(
        `Unsupported quote asset: ${quote}. Supported assets: ${this.SUPPORTED_ASSETS.join(', ')}`,
      );
    }

    if (base === quote) {
      throw new BadRequestException(
        'Base and quote assets cannot be the same',
      );
    }
  }

  /**
   * Validates price logic based on signal action
   * BUY: targetPrice > entryPrice > stopLoss
   * SELL: targetPrice < entryPrice < stopLoss
   */
  validatePriceLogic(dto: CreateSignalDto): void {
    const { action, entryPrice, targetPrice, stopLoss } = dto;

    if (action === SignalAction.BUY) {
      // For BUY signals: target should be higher than entry
      if (targetPrice <= entryPrice) {
        throw new BadRequestException(
          'BUY signal: Target price must be greater than entry price',
        );
      }

      // Stop loss should be lower than entry
      if (stopLoss >= entryPrice) {
        throw new BadRequestException(
          'BUY signal: Stop loss must be lower than entry price',
        );
      }

      // Validate reasonable risk-reward ratio (optional but recommended)
      const profit = targetPrice - entryPrice;
      const risk = entryPrice - stopLoss;
      const riskRewardRatio = profit / risk;

      if (riskRewardRatio < 0.5) {
        throw new BadRequestException(
          `Poor risk-reward ratio (${riskRewardRatio.toFixed(2)}). Minimum recommended: 0.5`,
        );
      }
    } else if (action === SignalAction.SELL) {
      // For SELL signals: target should be lower than entry
      if (targetPrice >= entryPrice) {
        throw new BadRequestException(
          'SELL signal: Target price must be lower than entry price',
        );
      }

      // Stop loss should be higher than entry
      if (stopLoss <= entryPrice) {
        throw new BadRequestException(
          'SELL signal: Stop loss must be higher than entry price',
        );
      }

      // Validate reasonable risk-reward ratio
      const profit = entryPrice - targetPrice;
      const risk = stopLoss - entryPrice;
      const riskRewardRatio = profit / risk;

      if (riskRewardRatio < 0.5) {
        throw new BadRequestException(
          `Poor risk-reward ratio (${riskRewardRatio.toFixed(2)}). Minimum recommended: 0.5`,
        );
      }
    }

    // Validate price ranges are reasonable (not too extreme)
    const maxPrice = Math.max(entryPrice, targetPrice, stopLoss);
    const minPrice = Math.min(entryPrice, targetPrice, stopLoss);
    const priceRange = ((maxPrice - minPrice) / minPrice) * 100;

    if (priceRange > 200) {
      throw new BadRequestException(
        `Price range too extreme (${priceRange.toFixed(0)}%). Maximum allowed: 200%`,
      );
    }
  }

  /**
   * Validates signal quality based on rationale and structure
   */
  validateSignalQuality(dto: CreateSignalDto): number {
    let qualityScore = 50; // Base score

    // Rationale length scoring
    const rationaleLength = dto.rationale.length;
    if (rationaleLength > 100) qualityScore += 10;
    if (rationaleLength > 200) qualityScore += 10;

    // Check for technical indicators in rationale
    const technicalTerms = [
      'rsi',
      'macd',
      'ema',
      'sma',
      'support',
      'resistance',
      'volume',
      'fibonacci',
      'bollinger',
      'momentum',
    ];
    const rationaleLC = dto.rationale.toLowerCase();
    const termsFound = technicalTerms.filter((term) =>
      rationaleLC.includes(term),
    ).length;
    qualityScore += termsFound * 5; // 5 points per technical term

    // Risk-reward ratio scoring
    const { action, entryPrice, targetPrice, stopLoss } = dto;
    let riskRewardRatio: number;

    if (action === SignalAction.BUY) {
      const profit = targetPrice - entryPrice;
      const risk = entryPrice - stopLoss;
      riskRewardRatio = profit / risk;
    } else {
      const profit = entryPrice - targetPrice;
      const risk = stopLoss - entryPrice;
      riskRewardRatio = profit / risk;
    }

    if (riskRewardRatio >= 2) qualityScore += 15;
    else if (riskRewardRatio >= 1.5) qualityScore += 10;
    else if (riskRewardRatio >= 1) qualityScore += 5;

    // Cap at 100
    return Math.min(qualityScore, 100);
  }

  /**
   * Checks for duplicate signals
   */
  async checkDuplicateSignal(
    providerId: string,
    assetPair: string,
    recentSignals: any[],
  ): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const duplicates = recentSignals.filter(
      (signal) =>
        signal.providerId === providerId &&
        signal.assetPair === assetPair &&
        new Date(signal.createdAt) > oneHourAgo,
    );

    if (duplicates.length > 0) {
      throw new ConflictException(
        `Duplicate signal detected. You already submitted a signal for ${assetPair} within the last hour`,
      );
    }
  }

  /**
   * Complete validation pipeline
   */
  async validateSignal(
    dto: CreateSignalDto,
    providerId: string,
    recentSignals: any[],
  ): Promise<{ qualityScore: number }> {
    // Validate asset pair
    this.validateAssetPair(dto.assetPair);

    // Validate price logic
    this.validatePriceLogic(dto);

    // Check for duplicates
    await this.checkDuplicateSignal(providerId, dto.assetPair, recentSignals);

    // Calculate quality score
    const qualityScore = this.validateSignalQuality(dto);

    return { qualityScore };
  }
}