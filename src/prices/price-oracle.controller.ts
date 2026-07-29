import { Controller, Get, Query } from '@nestjs/common';
import { PriceOracleService } from './price-oracle.service';
import { GetPriceDto } from './dto/get-price.dto';
import { CircuitBreakerService } from '../http/circuit-breaker.service';

@Controller('prices')
export class PriceOracleController {
  constructor(
    private readonly priceOracleService: PriceOracleService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  @Get('circuit-status')
  getCircuitStatus() {
    return this.circuitBreaker.getAllStats();
  }

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
