import { Controller, Get, Query } from '@nestjs/common';
import { PriceOracleService } from './price-oracle.service';
import { GetPriceDto } from './dto/get-price.dto';

@Controller('prices')
export class PriceOracleController {
  constructor(private readonly priceOracleService: PriceOracleService) {}

  @Get()
  async getPrice(@Query() query: GetPriceDto) {
    return this.priceOracleService.getPrice(query.assetPair);
  }

  @Get('history')
  async getPriceHistory(
    @Query('assetPair') assetPair: string,
    @Query('hours') hours: number = 24,
  ) {
    return this.priceOracleService.getPriceHistory(assetPair, hours);
  }
}
