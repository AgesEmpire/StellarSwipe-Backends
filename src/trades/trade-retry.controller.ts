import { Controller, Post, Param, UseGuards, Request } from '@nestjs/common';
import { TradeRetryService } from './services/trade-retry.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('trades')
export class TradeRetryController {
  constructor(private readonly tradeRetryService: TradeRetryService) {}

  @Post(':id/retry')
  retryTrade(@Param('id') id: string) {
    return this.tradeRetryService.retryFailedTrade(id);
  }
}
