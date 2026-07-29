import { CancelTradeHandler } from './cancel-trade.handler';
import { CancelTradeCommand } from '../cancel-trade.command';
import { TradesService } from '../../../trades.service';

describe('CancelTradeHandler', () => {
  it('delegates to TradesService.closeTrade and returns its result', async () => {
    const tradesService = {
      closeTrade: jest.fn().mockResolvedValue({ success: true }),
    } as unknown as TradesService;
    const handler = new CancelTradeHandler(tradesService);
    const dto = { tradeId: 't1', userId: 'u1' } as any;

    const result = await handler.execute(new CancelTradeCommand(dto));

    expect(tradesService.closeTrade).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ success: true });
  });
});
