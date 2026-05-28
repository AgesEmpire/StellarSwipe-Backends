import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  ValidationPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LimitOrderService } from './limit-order.service';
import { PlaceLimitOrderDto, LimitOrderStatusDto } from './dto/limit-order.dto';

@ApiTags('trades')
@Controller('trades/limit-orders')
export class LimitOrderController {
  constructor(private readonly limitOrderService: LimitOrderService) {}

  @Post()
  @ApiOperation({ summary: 'Place a limit order via Soroban / SDEX' })
  @ApiResponse({ status: 201, type: LimitOrderStatusDto })
  async place(
    @Body(new ValidationPipe({ transform: true, whitelist: true })) dto: PlaceLimitOrderDto,
  ): Promise<LimitOrderStatusDto> {
    return this.limitOrderService.place(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get limit order status' })
  @ApiResponse({ status: 200, type: LimitOrderStatusDto })
  async getStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('userId', ParseUUIDPipe) userId: string,
  ): Promise<LimitOrderStatusDto> {
    return this.limitOrderService.getStatus(id, userId);
  }
}
