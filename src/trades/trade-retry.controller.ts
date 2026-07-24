import { Controller, Post, Param, UseGuards, Request } from '@nestjs/common';
import { TradeRetryService } from './services/trade-retry.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('trades')
export class TradeRetryController {
  constructor(private readonly tradeRetryService: TradeRetryService) {}

  @Post(':id/retry')
  retryTrade(@Param('id') id: string, @Request() req: any) {
    const requestingUserId: string = req.user?.id ?? req.user?.sub;
    const isAdmin: boolean = req.user?.roles?.includes('admin') ?? false;
    return this.tradeRetryService.retryFailedTrade(id, requestingUserId, isAdmin);
  }
}
