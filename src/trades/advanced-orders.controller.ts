import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { OcoOrderService } from './services/oco-order.service';
import { IcebergOrderService } from './services/iceberg-order.service';
import {
  CancelIcebergOrderDto,
  CancelOcoOrderDto,
  CreateIcebergOrderDto,
  CreateOcoOrderDto,
  IcebergOrderResponseDto,
  OcoOrderResponseDto,
} from './dto';
import { AdvancedOrderStatus } from './entities/advanced-order.entity';

@Controller('trades/advanced')
export class AdvancedOrdersController {
  constructor(
    private readonly ocoService: OcoOrderService,
    private readonly icebergService: IcebergOrderService,
  ) {}

  // ─── OCO Endpoints ─────────────────────────────────────────────────────────

  /**
   * Create an OCO order (stop-loss + take-profit linked).
   * POST /trades/advanced/oco
   */
  @Post('oco')
  @HttpCode(HttpStatus.CREATED)
  async createOcoOrder(
    @Body() dto: CreateOcoOrderDto,
  ): Promise<OcoOrderResponseDto> {
    return this.ocoService.createOrder(dto);
  }

  /**
   * Cancel an active OCO order (both legs).
   * DELETE /trades/advanced/oco/:orderId
   */
  @Delete('oco/:orderId')
  @HttpCode(HttpStatus.OK)
  async cancelOcoOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CancelOcoOrderDto,
  ): Promise<OcoOrderResponseDto> {
    return this.ocoService.cancelOrder({ ...dto, orderId });
  }

  /**
   * Get a single OCO order.
   * GET /trades/advanced/oco/:orderId?userId=...
   */
  @Get('oco/:orderId')
  async getOcoOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query('userId', ParseUUIDPipe) userId: string,
  ): Promise<OcoOrderResponseDto> {
    return this.ocoService.getOrder(orderId, userId);
  }

  /**
   * List all OCO orders for a user.
   * GET /trades/advanced/oco?userId=...&status=ACTIVE
   */
  @Get('oco')
  async listOcoOrders(
    @Query('userId', ParseUUIDPipe) userId: string,
    @Query('status') status?: AdvancedOrderStatus,
  ): Promise<OcoOrderResponseDto[]> {
    return this.ocoService.listOrders(userId, status);
  }

  /**
   * Manually trigger the OCO fill check (useful in tests / admin tooling).
   * POST /trades/advanced/oco/:orderId/check
   */
  @Post('oco/:orderId/check')
  @HttpCode(HttpStatus.NO_CONTENT)
  async checkOcoOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body('sourceSecret') sourceSecret: string,
  ): Promise<void> {
    await this.ocoService.checkAndExecute(orderId, sourceSecret);
  }

  // ─── Iceberg Endpoints ─────────────────────────────────────────────────────

  /**
   * Create an iceberg order (hidden liquidity).
   * POST /trades/advanced/iceberg
   */
  @Post('iceberg')
  @HttpCode(HttpStatus.CREATED)
  async createIcebergOrder(
    @Body() dto: CreateIcebergOrderDto,
  ): Promise<IcebergOrderResponseDto> {
    return this.icebergService.createOrder(dto);
  }

  /**
   * Cancel an active iceberg order.
   * DELETE /trades/advanced/iceberg/:orderId
   */
  @Delete('iceberg/:orderId')
  @HttpCode(HttpStatus.OK)
  async cancelIcebergOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CancelIcebergOrderDto,
  ): Promise<IcebergOrderResponseDto> {
    return this.icebergService.cancelOrder({ ...dto, orderId });
  }

  /**
   * Get a single iceberg order.
   * GET /trades/advanced/iceberg/:orderId?userId=...
   */
  @Get('iceberg/:orderId')
  async getIcebergOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query('userId', ParseUUIDPipe) userId: string,
  ): Promise<IcebergOrderResponseDto> {
    return this.icebergService.getOrder(orderId, userId);
  }

  /**
   * List all iceberg orders for a user.
   * GET /trades/advanced/iceberg?userId=...&status=ACTIVE
   */
  @Get('iceberg')
  async listIcebergOrders(
    @Query('userId', ParseUUIDPipe) userId: string,
    @Query('status') status?: AdvancedOrderStatus,
  ): Promise<IcebergOrderResponseDto[]> {
    return this.icebergService.listOrders(userId, status);
  }

  /**
   * Manually trigger a refill check for an iceberg order.
   * POST /trades/advanced/iceberg/:orderId/refill
   */
  @Post('iceberg/:orderId/refill')
  @HttpCode(HttpStatus.NO_CONTENT)
  async checkIcebergRefill(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body('sourceSecret') sourceSecret: string,
  ): Promise<void> {
    await this.icebergService.checkAndRefill(orderId, sourceSecret);
  }
}
