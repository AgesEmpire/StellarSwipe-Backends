import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketRegime, MarketRegimeType } from './entities/market-regime.entity';
import { RegimeTransition } from './entities/regime-transition.entity';
import { PriceOracleService } from '../../prices/price-oracle.service';
import { DetectRegimeDto, RegimeResponseDto } from './dto/regime-detection.dto';

@Injectable()
export class RegimeDetectorService {
  private readonly logger = new Logger(RegimeDetectorService.name);
  private readonly VOLATILITY_THRESHOLD = 0.02; // 2% 
  private readonly TREND_THRESHOLD = 0.005; // 0.5% slope

  constructor(
    @InjectRepository(MarketRegime)
    private readonly regimeRepository: Repository<MarketRegime>,
    @InjectRepository(RegimeTransition)
    private readonly transitionRepository: Repository<RegimeTransition>,
    private readonly priceOracleService: PriceOracleService,
  ) {}

  /**
   * Detect current market regime for an asset pair.
   */
  async detectRegime(dto: DetectRegimeDto): Promise<RegimeResponseDto> {
    const assetPair = dto.assetPair || 'XLM-USDC';
    const lookback = dto.lookbackPeriods || 24;

    this.logger.log(`Detecting market regime for ${assetPair} (lookback: ${lookback}h)`);

    const history = await this.priceOracleService.getPriceHistory(assetPair, lookback);
    if (history.length < 5) {
      return this.fallbackRegime(assetPair);
    }

    const prices = history.map((h) => Number(h.price)).reverse();
    const returns = this.calculateReturns(prices);
    
    const volatility = this.calculateVolatility(returns);
    const trend = this.calculateTrendSlope(prices);

    const type = this.classifyRegime(volatility, trend);
    const confidence = this.calculateConfidence(volatility, trend, type);

    const currentRegime = await this.getCurrentRegime(assetPair);

    if (!currentRegime || currentRegime.type !== type) {
      await this.handleTransition(assetPair, currentRegime, type, confidence, {
        volatility,
        trend,
      });
    }

    const regime = currentRegime && currentRegime.type === type 
      ? currentRegime 
      : await this.saveNewRegime(assetPair, type, confidence, { volatility, trend });

    return this.toResponseDto(regime);
  }

  private classifyRegime(volatility: number, trend: number): MarketRegimeType {
    if (volatility > this.VOLATILITY_THRESHOLD) {
      return MarketRegimeType.VOLATILE;
    }
    if (trend > this.TREND_THRESHOLD) {
      return MarketRegimeType.BULL;
    }
    if (trend < -this.TREND_THRESHOLD) {
      return MarketRegimeType.BEAR;
    }
    return MarketRegimeType.SIDEWAYS;
  }

  private calculateReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    return returns;
  }

  private calculateVolatility(returns: number[]): number {
    if (returns.length === 0) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  private calculateTrendSlope(prices: number[]): number {
    const n = prices.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = prices.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((s, xi, i) => s + xi * prices[i], 0);
    const sumX2 = x.reduce((s, xi) => s + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    // Normalize slope relative to first price
    return slope / prices[0];
  }

  private calculateConfidence(vol: number, trend: number, type: MarketRegimeType): number {
    // Basic confidence score logic
    let score = 0.5;
    if (type === MarketRegimeType.VOLATILE) score = Math.min(0.9, vol / (this.VOLATILITY_THRESHOLD * 2));
    if (type === MarketRegimeType.BULL || type === MarketRegimeType.BEAR) {
      score = Math.min(0.95, Math.abs(trend) / (this.TREND_THRESHOLD * 3));
    }
    return Math.max(0.5, score);
  }

  private async getCurrentRegime(assetPair: string): Promise<MarketRegime | null> {
    return this.regimeRepository.findOne({
      where: { assetPair, endTime: null },
      order: { startTime: 'DESC' },
    });
  }

  private async handleTransition(
    assetPair: string,
    from: MarketRegime | null,
    toType: MarketRegimeType,
    confidence: number,
    metrics: any,
  ) {
    if (from) {
      from.endTime = new Date();
      await this.regimeRepository.save(from);
    }

    const transition = this.transitionRepository.create({
      assetPair,
      fromRegime: from ? from.type : MarketRegimeType.SIDEWAYS,
      toRegime: toType,
      confidence,
      occurredAt: new Date(),
      reason: `Automated detection: vol=${metrics.volatility.toFixed(4)}, trend=${metrics.trend.toFixed(4)}`,
      triggerMetrics: metrics,
    });

    await this.transitionRepository.save(transition);
  }

  private async saveNewRegime(
    assetPair: string,
    type: MarketRegimeType,
    confidence: number,
    metrics: any,
  ): Promise<MarketRegime> {
    const regime = this.regimeRepository.create({
      assetPair,
      type,
      confidence,
      startTime: new Date(),
      metrics,
    });
    return this.regimeRepository.save(regime);
  }

  private fallbackRegime(assetPair: string): RegimeResponseDto {
    return {
      id: 'fallback',
      assetPair,
      type: MarketRegimeType.SIDEWAYS,
      confidence: 0.5,
      startTime: new Date(),
      endTime: null,
      metrics: null,
      summary: 'Insufficient data for regime detection. Defaulting to SIDEWAYS.',
    };
  }

  private toResponseDto(regime: MarketRegime): RegimeResponseDto {
    return {
      id: regime.id,
      assetPair: regime.assetPair,
      type: regime.type,
      confidence: Number(regime.confidence),
      startTime: regime.startTime,
      endTime: regime.endTime,
      metrics: regime.metrics,
      summary: `Market for ${regime.assetPair || 'global'} is currently in a ${regime.type.toUpperCase()} regime with ${(regime.confidence * 100).toFixed(1)}% confidence.`,
    };
  }
}
