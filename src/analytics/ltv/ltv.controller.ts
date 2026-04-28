import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { LtvCalculatorService } from './ltv-calculator.service';
import { LtvCalculationDto } from './dto/ltv-calculation.dto';

@Controller('analytics/ltv')
export class LtvController {
  constructor(private readonly ltvService: LtvCalculatorService) {}

  @Post('calculate')
  calculate(@Body() dto: LtvCalculationDto, @Query('months') months?: string) {
    return this.ltvService.calculate(dto, months ? parseInt(months) : 12);
  }

  @Post('forecast')
  forecast(@Body() dto: LtvCalculationDto, @Query('months') months?: string) {
    return this.ltvService.forecast(dto, months ? parseInt(months) : 12);
  }

  @Get('user/:userId')
  getByUser(@Param('userId') userId: string) {
    return this.ltvService.getByUser(userId);
  }

  @Get('segments')
  getSegments() {
    return this.ltvService.getSegments();
  }
}
