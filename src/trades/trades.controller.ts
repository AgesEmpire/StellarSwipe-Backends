import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { LimitOrderDto } from "./dto/limit-order.dto";
import { MarketOrderDto } from "./dto/market-order.dto";
import {
  LimitOrderResponseDto,
  MarketOrderResponseDto,
} from "./dto/order-response.dto";
import { LimitOrderService } from "./services/limit-order.service";
import { MarketOrderService } from "./services/market-order.service";

/**
 * Trades Controller
 *
 * Handles order execution for Stellar SDEX (Decentralized Exchange)
 * Supports both market orders (immediate execution) and limit orders (specific price)
 *
 * Base URL: /api/v1/trades
 */
@Controller("trades")
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class TradesController {
  constructor(
    private readonly marketOrderService: MarketOrderService,
    private readonly limitOrderService: LimitOrderService,
  ) {}

  /**
   * Execute Market Order
   *
   * Executes a market order with immediate fill at the best available price.
   * Market orders use Stellar's manageSellOffer with price "0" for fill-or-kill behavior.
   *
   * Features:
   * - Immediate execution at best available price
   * - Slippage protection (default 1%, configurable)
   * - Order book analysis before execution
   * - Comprehensive error handling
   *
   * @param dto Market order parameters
   * @returns Order execution result with transaction hash and price details
   *
   * @example
   * POST /api/v1/trades/market-orders
   * {
   *   "sourceSecret": "S...",
   *   "sellingAssetCode": "USDC",
   *   "sellingAssetIssuer": "GA...",
   *   "buyingAssetCode": "XLM",
   *   "amount": 100,
   *   "maxSlippagePercent": 1
   * }
   */
  @Post("market-orders")
  @HttpCode(HttpStatus.OK)
  async executeMarketOrder(
    @Body() dto: MarketOrderDto,
  ): Promise<MarketOrderResponseDto> {
    return this.marketOrderService.executeOrder(dto);
  }

  /**
   * Place Limit Order
   *
   * Places a limit order that waits for a specific price to be reached.
   * Limit orders use Stellar's manageSellOffer with a specified price.
   *
   * Features:
   * - Order placed at specific price
   * - May fill immediately if price crosses spread
   * - Supports partial fills
   * - Order book context analysis
   *
   * @param dto Limit order parameters
   * @returns Order placement result with transaction hash and status
   *
   * @example
   * POST /api/v1/trades/limit-orders
   * {
   *   "sourceSecret": "S...",
   *   "sellingAssetCode": "XLM",
   *   "buyingAssetCode": "USDC",
   *   "buyingAssetIssuer": "GA...",
   *   "amount": 100,
   *   "price": 0.12
   * }
   */
  @Post("limit-orders")
  @HttpCode(HttpStatus.OK)
  async placeLimitOrder(
    @Body() dto: LimitOrderDto,
  ): Promise<LimitOrderResponseDto> {
    return this.limitOrderService.placeOrder(dto);
  }
}
