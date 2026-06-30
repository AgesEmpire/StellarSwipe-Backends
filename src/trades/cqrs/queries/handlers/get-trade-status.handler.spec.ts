import { GetTradeStatusHandler } from './get-trade-status.handler';
import { GetTradeStatusQuery } from '../get-trade-status.query';
import { TradesService } from '../../../trades.service';

describe('GetTradeStatusHandler', () => {
  it('delegates to TradesService.getTradeById and returns its result', async () => {
    const tradesService = {
      getTradeById: jest.fn().mockResolvedValue({ id: 't1', status: 'OPEN' }),
    } as unknown as TradesService;
    const handler = new GetTradeStatusHandler(tradesService);

    const result = await handler.execute(new GetTradeStatusQuery('t1', 'u1'));

    expect(tradesService.getTradeById).toHaveBeenCalledWith('t1', 'u1');
    expect(result).toEqual({ id: 't1', status: 'OPEN' });
  });
});
