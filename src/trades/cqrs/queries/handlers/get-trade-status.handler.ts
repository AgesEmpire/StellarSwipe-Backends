import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetTradeStatusQuery } from '../get-trade-status.query';
import { TradesService } from '../../../trades.service';
import { TradeDetailsDto } from '../../../dto/trade-result.dto';

@QueryHandler(GetTradeStatusQuery)
export class GetTradeStatusHandler implements IQueryHandler<
  GetTradeStatusQuery,
  TradeDetailsDto
> {
  constructor(private readonly tradesService: TradesService) {}

  execute(query: GetTradeStatusQuery): Promise<TradeDetailsDto> {
    return this.tradesService.getTradeById(query.tradeId, query.userId);
  }
}
