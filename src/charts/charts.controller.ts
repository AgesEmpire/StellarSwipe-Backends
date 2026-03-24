import { Controller, Get, Param, Query } from '@nestjs/common';
import { ChartsService } from './charts.service';
import { OhlcvQueryDto } from './dto/ohlcv-query.dto';
import { IndicatorsQueryDto } from './dto/indicators-query.dto';

@Controller('charts')
export class ChartsController {
  constructor(private readonly chartsService: ChartsService) {}

  /**
   * GET /charts/ohlcv/:assetPair
   * Returns OHLCV candlestick data for the given asset pair.
   * assetPair should be URL-encoded (e.g. USDC%2FXLM for USDC/XLM).
   */
  @Get('ohlcv/:assetPair')
  async getOhlcv(
    @Param('assetPair') assetPair: string,
    @Query() query: OhlcvQueryDto,
  ) {
    return this.chartsService.getOhlcv(assetPair, query);
  }

  /**
   * GET /charts/indicators/:assetPair
   * Returns technical indicators (SMA, EMA, RSI, MACD) for the given asset pair.
   */
  @Get('indicators/:assetPair')
  async getIndicators(
    @Param('assetPair') assetPair: string,
    @Query() query: IndicatorsQueryDto,
  ) {
    return this.chartsService.getIndicators(assetPair, query);
  }
}
