import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { PositionSizingService } from './services/position-sizing.service';
import { CalculateSizeDto } from './dto/calculate-size.dto';
import { PositionSizeResultDto } from './dto/position-size-result.dto';

@Controller('trades')
export class TradesController {
  constructor(private readonly positionSizingService: PositionSizingService) {}

  @Post('calculate-size')
  @HttpCode(HttpStatus.OK)
  calculateSize(@Body() dto: CalculateSizeDto): PositionSizeResultDto {
    return this.positionSizingService.calculate(dto);
  }
}
