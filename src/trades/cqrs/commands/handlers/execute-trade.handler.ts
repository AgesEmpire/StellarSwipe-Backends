import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ExecuteTradeCommand } from '../execute-trade.command';
import { TradesService } from '../../../trades.service';
import { TradeResultDto } from '../../../dto/trade-result.dto';

@CommandHandler(ExecuteTradeCommand)
export class ExecuteTradeHandler implements ICommandHandler<
  ExecuteTradeCommand,
  TradeResultDto
> {
  constructor(private readonly tradesService: TradesService) {}

  execute(command: ExecuteTradeCommand): Promise<TradeResultDto> {
    return this.tradesService.executeTrade(command.dto);
  }
}
