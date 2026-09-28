import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Keypair } from '@stellar/stellar-sdk';
import { RateLimit, RateLimitTier } from '../common/decorators/rate-limit.decorator';
import { MarketOrderService } from './services/market-order.service';
import { MarketOrderDto } from './dto/market-order.dto';
import { MarketOrderResponseDto } from './dto/order-response.dto';

@ApiTags('trades')
@Controller('trades')
export class MarketOrderController {
  constructor(private readonly marketOrderService: MarketOrderService) {}

  /**
   * POST /trades/market
   * Execute a market order immediately against the SDEX best available quote.
   * Balance validation, slippage guard, and self-trade protection run before
   * any transaction is submitted to the network.
   */
  @Post('market')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ tier: RateLimitTier.TRADE })
  @ApiOperation({ summary: 'Execute a market order at best SDEX quote' })
  @ApiResponse({ status: 201, description: 'Order filled — returns fill details' })
  @ApiResponse({ status: 400, description: 'Validation error (invalid key, same-asset trade, etc.)' })
  @ApiResponse({ status: 422, description: 'Low liquidity, self-trade, or slippage exceeded' })
  @ApiResponse({ status: 429, description: 'Trade rate limit exceeded — see Retry-After header' })
  async executeMarketOrder(@Body() dto: MarketOrderDto): Promise<MarketOrderResponseDto> {
    this.guardSelfTrade(dto);
    return this.marketOrderService.executeOrder(dto);
  }

  /**
   * Rejects orders where the source account is trading with itself.
   * Stellar's op_cross_self also catches this at the network layer, but we
   * surface a clear 400 before any network round-trip.
   */
  private guardSelfTrade(dto: MarketOrderDto): void {
    if (!dto.sourceSecret) return;
    try {
      const publicKey = Keypair.fromSecret(dto.sourceSecret).publicKey();
      // Self-trade is only possible if selling XLM to XLM (same asset),
      // which the service already blocks; here we guard identical asset codes
      // that would be caught by Stellar as op_offer_cross_self.
      if (
        dto.sellingAssetCode === dto.buyingAssetCode &&
        (dto.sellingAssetIssuer ?? 'native') === (dto.buyingAssetIssuer ?? 'native')
      ) {
        throw new BadRequestException(
          `Self-trade rejected: account ${publicKey} cannot buy and sell the same asset`,
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Invalid source secret key format');
    }
  }
}
