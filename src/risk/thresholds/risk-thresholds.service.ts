import { BadRequestException, Injectable } from '@nestjs/common';
import { RiskEvaluationDto, RiskThresholdDto } from './dto/risk-threshold.dto';
import { UpdateRiskThresholdDto } from './dto/update-risk-threshold.dto';
import { RiskThresholdType } from './entities/risk-threshold.entity';

export interface RiskViolation {
  type: RiskThresholdType;
  threshold: number;
  actual: number;
  reason: string;
}

export interface RiskEvaluationResult {
  allowed: boolean;
  violations: RiskViolation[];
}

const DEFAULT_THRESHOLDS: Record<RiskThresholdType, number> = {
  [RiskThresholdType.ORDER_SIZE]: 100_000,
  [RiskThresholdType.LEVERAGE]: 5,
  [RiskThresholdType.ASSET_EXPOSURE]: 250_000,
};

@Injectable()
export class RiskThresholdsService {
  private readonly thresholds = new Map<RiskThresholdType, RiskThresholdDto>();

  constructor() {
    for (const [type, value] of Object.entries(DEFAULT_THRESHOLDS)) {
      this.thresholds.set(type as RiskThresholdType, {
        type: type as RiskThresholdType,
        value,
        description: 'Default risk threshold',
      });
    }
  }

  listThresholds(): RiskThresholdDto[] {
    return Array.from(this.thresholds.values()).map((threshold) => ({ ...threshold }));
  }

  getThreshold(type: RiskThresholdType): RiskThresholdDto {
    const threshold = this.thresholds.get(type);
    if (!threshold) {
      throw new BadRequestException(`Unknown risk threshold type: ${type}`);
    }

    return { ...threshold };
  }

  updateThreshold(
    type: RiskThresholdType,
    dto: UpdateRiskThresholdDto,
  ): RiskThresholdDto {
    this.validateThreshold(type, dto.value);

    const updated: RiskThresholdDto = {
      ...this.getThreshold(type),
      value: dto.value,
      description: dto.description,
      updatedBy: dto.updatedBy,
    };

    this.thresholds.set(type, updated);
    return { ...updated };
  }

  evaluate(dto: RiskEvaluationDto): RiskEvaluationResult {
    const violations: RiskViolation[] = [];
    const orderSizeThreshold = this.getThreshold(RiskThresholdType.ORDER_SIZE).value;
    const leverageThreshold = this.getThreshold(RiskThresholdType.LEVERAGE).value;
    const assetExposureThreshold = this.getThreshold(RiskThresholdType.ASSET_EXPOSURE).value;

    if (dto.orderSize > orderSizeThreshold) {
      violations.push(this.violation(
        RiskThresholdType.ORDER_SIZE,
        orderSizeThreshold,
        dto.orderSize,
      ));
    }

    if (dto.leverage > leverageThreshold) {
      violations.push(this.violation(
        RiskThresholdType.LEVERAGE,
        leverageThreshold,
        dto.leverage,
      ));
    }

    for (const [asset, exposure] of Object.entries(dto.assetExposure ?? {})) {
      if (exposure > assetExposureThreshold) {
        violations.push({
          ...this.violation(RiskThresholdType.ASSET_EXPOSURE, assetExposureThreshold, exposure),
          reason: `${asset} exposure ${exposure} exceeds threshold ${assetExposureThreshold}`,
        });
      }
    }

    return {
      allowed: violations.length === 0,
      violations,
    };
  }

  private validateThreshold(type: RiskThresholdType, value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(`${type} threshold must be greater than zero`);
    }
  }

  private violation(
    type: RiskThresholdType,
    threshold: number,
    actual: number,
  ): RiskViolation {
    return {
      type,
      threshold,
      actual,
      reason: `${type} ${actual} exceeds threshold ${threshold}`,
    };
  }
}
