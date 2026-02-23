import { Injectable, BadRequestException } from '@nestjs/common';
import { CalculateSizeDto, SizingMethod } from '../dto/calculate-size.dto';
import { PositionSizeResultDto } from '../dto/position-size-result.dto';

const DEFAULT_MAX_POSITION_PCT = 20; // 20% of account balance max
const MIN_BALANCE_THRESHOLD = 100;   // Minimum $100 to place a trade

@Injectable()
export class PositionSizingService {
  calculate(dto: CalculateSizeDto): PositionSizeResultDto {
    const warnings: string[] = [];

    if (dto.accountBalance < MIN_BALANCE_THRESHOLD) {
      throw new BadRequestException(
        `Account balance $${dto.accountBalance} is below the minimum required $${MIN_BALANCE_THRESHOLD}.`,
      );
    }

    const maxPositionPct = dto.maxPositionPct ?? DEFAULT_MAX_POSITION_PCT;
    const maxPositionSize = (dto.accountBalance * maxPositionPct) / 100;
    const confidence = dto.signalConfidence ?? 1.0;

    let rawSize: number;
    let rationale: string;

    switch (dto.method) {
      case SizingMethod.FIXED:
        ({ rawSize, rationale } = this.fixedPercentage(dto));
        break;
      case SizingMethod.KELLY:
        ({ rawSize, rationale } = this.kellyCriterion(dto, warnings));
        break;
      case SizingMethod.VOLATILITY:
        ({ rawSize, rationale } = this.volatilityAdjusted(dto, warnings));
        break;
      default:
        throw new BadRequestException(`Unknown sizing method: ${dto.method}`);
    }

    // Apply signal confidence scalar
    const confidenceAdjustedSize = rawSize * confidence;
    if (confidence < 1.0) {
      rationale += ` Scaled down by signal confidence (${(confidence * 100).toFixed(0)}%).`;
    }

    // Cap at maximum position limit
    let recommendedSize = confidenceAdjustedSize;
    if (confidenceAdjustedSize > maxPositionSize) {
      recommendedSize = maxPositionSize;
      warnings.push(
        `Recommended size was capped at the maximum position limit of ${maxPositionPct}% ($${maxPositionSize.toFixed(2)}).`,
      );
    }

    // Ensure the balance is sufficient
    if (recommendedSize > dto.accountBalance) {
      throw new BadRequestException(
        `Insufficient balance: recommended size $${recommendedSize.toFixed(2)} exceeds account balance $${dto.accountBalance}.`,
      );
    }

    const riskAmount = (dto.accountBalance * dto.riskPercentage) / 100;
    const maxLoss = Math.min(recommendedSize, riskAmount);

    return {
      recommendedSize: parseFloat(recommendedSize.toFixed(2)),
      method: dto.method,
      rationale,
      riskAmount: parseFloat(riskAmount.toFixed(2)),
      maxLoss: parseFloat(maxLoss.toFixed(2)),
      warnings: warnings.length ? warnings : undefined,
    };
  }

  // ─── Sizing Methods ───────────────────────────────────────────────────────────

  private fixedPercentage(dto: CalculateSizeDto): {
    rawSize: number;
    rationale: string;
  } {
    const rawSize = (dto.accountBalance * dto.riskPercentage) / 100;
    const rationale = `Fixed percentage method: ${dto.riskPercentage}% of $${dto.accountBalance} account balance = $${rawSize.toFixed(2)}.`;
    return { rawSize, rationale };
  }

  private kellyCriterion(
    dto: CalculateSizeDto,
    warnings: string[],
  ): { rawSize: number; rationale: string } {
    const { winRate, avgWin, avgLoss, accountBalance, riskPercentage } = dto;

    // Validate required Kelly inputs
    if (
      winRate === undefined ||
      avgWin === undefined ||
      avgLoss === undefined
    ) {
      throw new BadRequestException(
        'Kelly Criterion requires winRate, avgWin, and avgLoss fields.',
      );
    }

    if (avgWin === 0) {
      throw new BadRequestException('avgWin must be greater than 0 for Kelly Criterion.');
    }

    // Kelly formula: f* = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin
    const kellyFraction =
      (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;

    if (kellyFraction <= 0) {
      warnings.push(
        `Kelly Criterion returned a non-positive fraction (${kellyFraction.toFixed(4)}), indicating negative expected value. Falling back to fixed percentage.`,
      );
      // Fallback to fixed percentage
      const fallback = (accountBalance * riskPercentage) / 100;
      return {
        rawSize: fallback,
        rationale: `Kelly Criterion indicated negative edge (f*=${kellyFraction.toFixed(4)}). Fell back to fixed percentage: $${fallback.toFixed(2)}.`,
      };
    }

    if (kellyFraction > 0.25) {
      warnings.push(
        `Full Kelly fraction (${(kellyFraction * 100).toFixed(1)}%) is aggressive. Using Half-Kelly for safety.`,
      );
    }

    // Use Half-Kelly to reduce variance
    const appliedFraction = Math.min(kellyFraction, 0.25) * 0.5;
    const rawSize = accountBalance * appliedFraction;

    const rationale =
      `Kelly Criterion: f*=${(kellyFraction * 100).toFixed(2)}% ` +
      `(winRate=${(winRate * 100).toFixed(1)}%, avgWin=${avgWin}, avgLoss=${avgLoss}). ` +
      `Half-Kelly applied: ${(appliedFraction * 100).toFixed(2)}% → $${rawSize.toFixed(2)}.`;

    return { rawSize, rationale };
  }

  private volatilityAdjusted(
    dto: CalculateSizeDto,
    warnings: string[],
  ): { rawSize: number; rationale: string } {
    const { accountBalance, riskPercentage, assetVolatility } = dto;

    if (assetVolatility === undefined) {
      throw new BadRequestException(
        'Volatility-adjusted method requires the assetVolatility field.',
      );
    }

    if (assetVolatility === 0) {
      throw new BadRequestException('assetVolatility must be greater than 0.');
    }

    // Extreme volatility guard (> 100% annualized)
    if (assetVolatility > 1.0) {
      warnings.push(
        `Extreme volatility detected (${(assetVolatility * 100).toFixed(1)}% annualized). Position size will be significantly reduced.`,
      );
    }

    // Target volatility approach:
    // positionSize = (accountBalance * riskPercentage/100) / assetVolatility
    const riskAmount = (accountBalance * riskPercentage) / 100;
    let rawSize = riskAmount / assetVolatility;

    // Normalize: daily volatility approximation (annualized / sqrt(252))
    const dailyVol = assetVolatility / Math.sqrt(252);
    const rationale =
      `Volatility-adjusted: risk amount $${riskAmount.toFixed(2)} ÷ annualized vol ${(assetVolatility * 100).toFixed(1)}% ` +
      `(daily ≈ ${(dailyVol * 100).toFixed(2)}%) = $${rawSize.toFixed(2)}.`;

    return { rawSize, rationale };
  }
}
