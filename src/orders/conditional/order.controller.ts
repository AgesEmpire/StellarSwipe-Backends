import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ConditionalOrderService } from './conditional-order.service';
import { ConditionalOrder } from './conditional-order.entity';
import {
  CreateConditionalOrderDto,
  UpdateConditionalOrderDto,
  ConditionalOrderStatus,
} from './dto/create-conditional-order.dto';

@ApiTags('Conditional Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders/conditional')
export class ConditionalOrderController {
  constructor(
    private readonly conditionalOrderService: ConditionalOrderService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new conditional order' })
  @ApiOkResponse({ description: 'Conditional order created', type: ConditionalOrder })
  async create(@Body() dto: CreateConditionalOrderDto, @Req() req: any): Promise<ConditionalOrder> {
    return this.conditionalOrderService.create(dto, req.user);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get conditional order by ID' })
  @ApiParam({ name: 'id', description: 'Conditional order UUID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: any): Promise<ConditionalOrder> {
    return this.conditionalOrderService.findById(id, req.user);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List conditional orders for a user' })
  async findByUser(
    @Query('userId') userId: string,
    @Query('status') status?: ConditionalOrderStatus,
    @Req() req: any,
  ): Promise<ConditionalOrder[]> {
    return this.conditionalOrderService.findByUser(userId || req.user.id, status, req.user);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a conditional order' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConditionalOrderDto,
    @Req() req: any,
  ): Promise<ConditionalOrder> {
    return this.conditionalOrderService.update(id, dto, req.user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a conditional order' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: any): Promise<ConditionalOrder> {
    return this.conditionalOrderService.cancel(id, req.user);
  }

  @Post(':id/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually execute a triggered conditional order' })
  async execute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('tradeId') tradeId?: string,
    @Req() req: any,
  ): Promise<ConditionalOrder> {
    return this.conditionalOrderService.executeTriggeredOrder(id, tradeId, req.user);
  }
}
