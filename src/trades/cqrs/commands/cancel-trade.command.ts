import { CloseTradeDto } from '../../dto/execute-trade.dto';

/** Command to cancel/close an open trade. */
export class CancelTradeCommand {
  constructor(public readonly dto: CloseTradeDto) {}
}
