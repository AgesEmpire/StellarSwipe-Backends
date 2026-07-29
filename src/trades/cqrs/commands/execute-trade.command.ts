import { ExecuteTradeDto } from '../../dto/execute-trade.dto';

/** Command to execute a new trade. */
export class ExecuteTradeCommand {
  constructor(public readonly dto: ExecuteTradeDto) {}
}
