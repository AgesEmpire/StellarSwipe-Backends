import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { AggregatorService } from './aggregator.service';
import { QuoteRequest, RouteRequest } from './interfaces/quote-request.interface';
import { StellarAsset, AssetPair } from './interfaces/dex-adapter.interface';
import { AggregatedQuoteDto, DexComparisonDto } from './dto/aggregated-quote.dto';
import { OptimalRouteDto } from './dto/optimal-route.dto';

@ApiTags('DEX Aggregator')
@Controller('dex-aggregator')
export class AggregatorController {
  constructor(private readonly aggregatorService: AggregatorService) {}

  @Get('health')
  @ApiOperation({ summary: 'Check health status of all connected DEXes' })
  @ApiResponse({ status: 200, description: 'Health status map per DEX' })
  async getDexHealth(): Promise<Record<string, boolean>> {
    return this.aggregatorService.getDexHealthStatus();
  }

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get aggregated quote from all DEXes' })
  @ApiResponse({ status: 200, type: AggregatedQuoteDto })
  async getAggregatedQuote(@Body() request: QuoteRequest): Promise<AggregatedQuoteDto> {
    return this.aggregatorService.getAggregatedQuote(request);
  }

  @Post('compare')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Compare prices across all DEXes' })
  @ApiResponse({ status: 200, type: DexComparisonDto })
  async compareDexes(@Body() request: QuoteRequest): Promise<DexComparisonDto> {
    return this.aggregatorService.compareDexes(request);
  }

  @Post('optimal-route')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Find the optimal trade route' })
  @ApiResponse({ status: 200, type: OptimalRouteDto })
  async findOptimalRoute(@Body() request: RouteRequest): Promise<OptimalRouteDto> {
    return this.aggregatorService.findOptimalRoute(request);
  }

  @Get('liquidity')
  @ApiOperation({ summary: 'Get aggregated liquidity pools for an asset pair' })
  @ApiQuery({ name: 'baseCode', example: 'XLM' })
  @ApiQuery({ name: 'counterCode', example: 'USDC' })
  @ApiQuery({ name: 'counterIssuer', required: false })
  async getAggregatedLiquidity(
    @Query('baseCode') baseCode: string,
    @Query('counterCode') counterCode: string,
    @Query('counterIssuer') counterIssuer?: string,
  ) {
    const baseAsset: StellarAsset = {
      code: baseCode,
      type: baseCode === 'XLM' ? 'native' : 'credit_alphanum4',
    };
    const counterAsset: StellarAsset = {
      code: counterCode,
      issuer: counterIssuer,
      type:
        counterCode === 'XLM'
          ? 'native'
          : counterCode.length <= 4
          ? 'credit_alphanum4'
          : 'credit_alphanum12',
    };
    const assetPair: AssetPair = { baseAsset, counterAsset };
    return this.aggregatorService.getAggregatedLiquidity(assetPair);
  }

  @Get('history')
  @ApiOperation({ summary: 'Retrieve historical route records from DB' })
  @ApiQuery({ name: 'sourceCode', example: 'XLM' })
  @ApiQuery({ name: 'destCode', example: 'USDC' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  async getRouteHistory(
    @Query('sourceCode') sourceCode: string,
    @Query('destCode') destCode: string,
    @Query('limit') limit = 50,
  ) {
    return this.aggregatorService.getRouteHistory(sourceCode, destCode, +limit);
  }
}
