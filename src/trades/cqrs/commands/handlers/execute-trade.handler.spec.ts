import { ExecuteTradeHandler } from './execute-trade.handler';
import { ExecuteTradeCommand } from '../execute-trade.command';
import { TradesService } from '../../../trades.service';

describe('ExecuteTradeHandler', () => {
  it('delegates to TradesService.executeTrade and returns its result', async () => {
    const tradesService = {
      executeTrade: jest.fn().mockResolvedValue({ id: 't1' }),
    } as unknown as TradesService;
    const handler = new ExecuteTradeHandler(tradesService);
    const dto = { userId: 'u1' } as any;

    const result = await handler.execute(new ExecuteTradeCommand(dto));

    expect(tradesService.executeTrade).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ id: 't1' });
  });
});
