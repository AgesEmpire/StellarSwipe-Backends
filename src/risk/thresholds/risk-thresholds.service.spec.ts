import { BadRequestException } from '@nestjs/common';
import { RiskThresholdType } from './entities/risk-threshold.entity';
import { RiskThresholdsService } from './risk-thresholds.service';

describe('RiskThresholdsService', () => {
  let service: RiskThresholdsService;

  beforeEach(() => {
    service = new RiskThresholdsService();
  });

  it('updates thresholds immediately for new evaluations', () => {
    service.updateThreshold(RiskThresholdType.ORDER_SIZE, {
      value: 500,
      updatedBy: 'risk-manager-1',
    });

    const result = service.evaluate({
      orderSize: 600,
      leverage: 1,
      assetExposure: {},
    });

    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toMatchObject({
      type: RiskThresholdType.ORDER_SIZE,
      threshold: 500,
      actual: 600,
    });
  });

  it('validates invalid threshold values before storing', () => {
    expect(() =>
      service.updateThreshold(RiskThresholdType.LEVERAGE, { value: 0 }),
    ).toThrow(BadRequestException);

    expect(service.getThreshold(RiskThresholdType.LEVERAGE).value).toBe(5);
  });

  it('allows orders within configured risk thresholds', () => {
    const result = service.evaluate({
      orderSize: 100,
      leverage: 2,
      assetExposure: { XLM: 1_000 },
    });

    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('enforces leverage and asset exposure thresholds', () => {
    service.updateThreshold(RiskThresholdType.LEVERAGE, { value: 3 });
    service.updateThreshold(RiskThresholdType.ASSET_EXPOSURE, { value: 1_000 });

    const result = service.evaluate({
      orderSize: 100,
      leverage: 4,
      assetExposure: { XLM: 1_500 },
    });

    expect(result.allowed).toBe(false);
    expect(result.violations.map((violation) => violation.type)).toEqual([
      RiskThresholdType.LEVERAGE,
      RiskThresholdType.ASSET_EXPOSURE,
    ]);
  });
});
