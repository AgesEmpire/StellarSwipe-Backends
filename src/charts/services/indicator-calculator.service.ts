import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { SmaCalculator } from '../indicators/sma.calculator';
import { EmaCalculator } from '../indicators/ema.calculator';
import { RsiCalculator } from '../indicators/rsi.calculator';
import { MacdCalculator, MacdPoint } from '../indicators/macd.calculator';

export interface IndicatorsResult {
  sma20: (number | null)[];
  sma50: (number | null)[];
  ema12: (number | null)[];
  ema26: (number | null)[];
  rsi: (number | null)[];
  macd: MacdPoint[];
}

const INDICATOR_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_PREFIX = 'stellarswipe:charts:indicators:';

@Injectable()
export class IndicatorCalculatorService {
  private readonly logger = new Logger(IndicatorCalculatorService.name);
  private readonly smaCalc = new SmaCalculator();
  private readonly emaCalc = new EmaCalculator();
  private readonly rsiCalc = new RsiCalculator();
  private readonly macdCalc = new MacdCalculator();

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async calculateIndicators(
    closePrices: number[],
    assetPair: string,
    timeframe: string,
  ): Promise<IndicatorsResult> {
    const cacheKey = `${CACHE_PREFIX}${assetPair}:${timeframe}:${closePrices.length}`;

    const cached = await this.cacheManager.get<IndicatorsResult>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for indicators: ${cacheKey}`);
      return cached;
    }

    const result: IndicatorsResult = {
      sma20: this.smaCalc.calculate(closePrices, 20),
      sma50: this.smaCalc.calculate(closePrices, 50),
      ema12: this.emaCalc.calculate(closePrices, 12),
      ema26: this.emaCalc.calculate(closePrices, 26),
      rsi: this.rsiCalc.calculate(closePrices, 14),
      macd: this.macdCalc.calculate(closePrices),
    };

    await this.cacheManager.set(cacheKey, result, INDICATOR_CACHE_TTL_MS);
    this.logger.debug(`Cached indicators: ${cacheKey}`);

    return result;
  }
}
