import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RouteOptimizerService } from './route-optimizer.service';
import { SwapRouteRequestDto } from './dto/swap-route-request.dto';
import { SwapRouteResponseDto } from './dto/swap-route-response.dto';

@Controller('swap/routes')
export class RouteController {
  constructor(private readonly routeOptimizerService: RouteOptimizerService) {}

  /**
   * Find the optimal swap route for a multi-hop asset exchange.
   *
   * POST /swap/routes/optimize
   *
   * Accepts source asset, destination asset, amount, and optional path
   * constraints. Returns the best route with expected cost and liquidity,
   * plus alternative routes for comparison.
   */
  @Post('optimize')
  @HttpCode(HttpStatus.OK)
  async optimizeRoute(
    @Body() request: SwapRouteRequestDto,
  ): Promise<SwapRouteResponseDto> {
    return this.routeOptimizerService.optimizeRoute(request);
  }
}
