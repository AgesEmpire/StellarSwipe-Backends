import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StopLossService } from './services/stop-loss.service';
import { TakeProfitService } from './services/take-profit.service';
import { TrailingStopService } from './services/trailing-stop.service';
import { SetStopLossDto } from './dto/set-stop-loss.dto';
import { SetTakeProfitDto } from './dto/set-take-profit.dto';

@ApiTags('trades')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trades/positions')
export class TradesController {
  constructor(
    private readonly stopLossService: StopLossService,
    private readonly takeProfitService: TakeProfitService,
    private readonly trailingStopService: TrailingStopService,
  ) {}

  @Patch(':id/stop-loss')
  @ApiOperation({ summary: 'Set stop-loss for a position (supports trailing)' })
  setStopLoss(@Param('id') id: string, @Body() dto: SetStopLossDto) {
    dto.positionId = id;
    return this.stopLossService.setStopLoss(dto);
  }

  @Patch(':id/take-profit')
  @ApiOperation({ summary: 'Set take-profit for a position (supports multi-level)' })
  setTakeProfit(@Param('id') id: string, @Body() dto: SetTakeProfitDto) {
    dto.positionId = id;
    return this.takeProfitService.setTakeProfit(dto);
  }
}
