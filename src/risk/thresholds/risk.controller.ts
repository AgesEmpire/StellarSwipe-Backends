import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RiskEvaluationDto } from './dto/risk-threshold.dto';
import { UpdateRiskThresholdDto } from './dto/update-risk-threshold.dto';
import { RiskThresholdType } from './entities/risk-threshold.entity';
import { RiskThresholdsService } from './risk-thresholds.service';

@Controller('risk/thresholds')
export class RiskController {
  constructor(private readonly riskThresholdsService: RiskThresholdsService) {}

  @Get()
  listThresholds() {
    return this.riskThresholdsService.listThresholds();
  }

  @Get(':type')
  getThreshold(@Param('type') type: RiskThresholdType) {
    return this.riskThresholdsService.getThreshold(type);
  }

  @Patch(':type')
  updateThreshold(
    @Param('type') type: RiskThresholdType,
    @Body() dto: UpdateRiskThresholdDto,
  ) {
    return this.riskThresholdsService.updateThreshold(type, dto);
  }

  @Post('evaluate')
  evaluate(@Body() dto: RiskEvaluationDto) {
    return this.riskThresholdsService.evaluate(dto);
  }
}
