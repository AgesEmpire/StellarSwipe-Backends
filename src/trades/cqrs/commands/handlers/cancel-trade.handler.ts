import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CancelTradeCommand } from '../cancel-trade.command';
import { TradesService } from '../../../trades.service';
import { CloseTradeResultDto } from '../../../dto/trade-result.dto';

@CommandHandler(CancelTradeCommand)
export class CancelTradeHandler implements ICommandHandler<
  CancelTradeCommand,
  CloseTradeResultDto
> {
  constructor(private readonly tradesService: TradesService) {}

  execute(command: CancelTradeCommand): Promise<CloseTradeResultDto> {
    return this.tradesService.closeTrade(command.dto);
  }
}
