import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { TradeEligibilityService } from './trade-eligibility.service';
import { CheckTradeEligibilityDto } from './dto/trade-eligibility.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('compliance/trade-eligibility')
@UseGuards(JwtAuthGuard)
export class TradeEligibilityController {
  constructor(private readonly eligibilityService: TradeEligibilityService) {}

  @Post('check')
  async checkEligibility(@Body() dto: CheckTradeEligibilityDto) {
    return this.eligibilityService.checkEligibility(dto);
  }
}
