import { Injectable, Logger } from '@nestjs/common';
import { OhlcvAggregatorService, OhlcvCandle } from './services/ohlcv-aggregator.service';
import { IndicatorCalculatorService, IndicatorsResult } from './services/indicator-calculator.service';
import { OhlcvQueryDto, Timeframe } from './dto/ohlcv-query.dto';
import { IndicatorsQueryDto } from './dto/indicators-query.dto';

export interface OhlcvResponse {
  assetPair: string;
  timeframe: Timeframe;
  data: OhlcvCandle[];
}

export interface IndicatorsResponse {
  assetPair: string;
  timeframe: Timeframe;
  indicators: IndicatorsResult;
}

@Injectable()
export class ChartsService {
  private readonly logger = new Logger(ChartsService.name);

  constructor(
    private readonly ohlcvAggregator: OhlcvAggregatorService,
    private readonly indicatorCalculator: IndicatorCalculatorService,
  ) {}

  async getOhlcv(assetPair: string, query: OhlcvQueryDto): Promise<OhlcvResponse> {
    const timeframe = query.timeframe ?? Timeframe.ONE_HOUR;
    const limit = query.limit ?? 100;

    this.logger.log(`Fetching OHLCV for ${assetPair} @ ${timeframe} (limit=${limit})`);

    const candles = await this.ohlcvAggregator.getOhlcv(assetPair, timeframe, limit);

    return {
      assetPair,
      timeframe,
      data: candles,
    };
  }

  async getIndicators(
    assetPair: string,
    query: IndicatorsQueryDto,
  ): Promise<IndicatorsResponse> {
    const timeframe = query.timeframe ?? Timeframe.ONE_HOUR;
    const limit = query.limit ?? 200;

    this.logger.log(`Fetching indicators for ${assetPair} @ ${timeframe} (limit=${limit})`);

    const candles = await this.ohlcvAggregator.getOhlcv(assetPair, timeframe, limit);
    const closePrices = candles.map((c) => c.close);

    const indicators = await this.indicatorCalculator.calculateIndicators(
      closePrices,
      assetPair,
      timeframe,
    );

    return {
      assetPair,
      timeframe,
      indicators,
    };
  }
}
