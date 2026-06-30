import { Body, Controller, HttpCode, HttpStatus, Post, ValidationPipe } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BatchOrderDto, BatchOrderResponseDto } from './dto/batch-order.dto';
import { BatchOrderService } from './batch-order.service';

@ApiTags('trades')
@Controller('trades/batch')
export class BatchOrderController {
  constructor(private readonly batchOrderService: BatchOrderService) {}

  /**
   * POST /trades/batch
   * Submit multiple orders in one request. Each order in the array is
   * validated independently. Valid orders are processed immediately; invalid
   * or failed orders are reported by index without blocking the others.
   */
  @Post()
  @HttpCode(HttpStatus.MULTI_STATUS)
  @ApiOperation({ summary: 'Submit a batch of trade orders with per-item validation' })
  @ApiResponse({
    status: HttpStatus.MULTI_STATUS,
    description: 'Batch processed — check accepted/rejected arrays for per-item outcomes',
    type: BatchOrderResponseDto,
  })
  async submitBatch(
    @Body(new ValidationPipe({ transform: true, whitelist: true, skipMissingProperties: false }))
    dto: BatchOrderDto,
  ): Promise<BatchOrderResponseDto> {
    return this.batchOrderService.submitBatch(dto);
  }
}
