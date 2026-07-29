import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ChurnPredictorService } from './churn-predictor.service';
import { UserEngagementFeatures } from './utils/engagement-scorer';

@Controller('ml/churn')
export class ChurnController {
  constructor(private readonly churnService: ChurnPredictorService) {}

  @Post('predict/:userId')
  predict(
    @Param('userId') userId: string,
    @Body() features: UserEngagementFeatures,
  ) {
    return this.churnService.predictForUser(userId, features);
  }

  @Get('high-risk')
  getHighRisk() {
    return this.churnService.getHighRiskUsers();
  }
}
