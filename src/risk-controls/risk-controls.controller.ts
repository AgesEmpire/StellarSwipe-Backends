import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { RiskControlsService } from './risk-controls.service';
import { SetRiskLevelsDto } from './dto/set-risk-levels.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('trades/risk-controls')
export class RiskControlsController {
  constructor(private readonly riskControlsService: RiskControlsService) {}

  @Post('levels')
  setRiskLevels(@Request() req: any, @Body() dto: SetRiskLevelsDto) {
    return this.riskControlsService.setRiskLevels(req.user.sub, dto);
  }
}
