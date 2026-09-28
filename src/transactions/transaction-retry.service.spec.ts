import { TransactionRetryService } from './transaction-retry.service';

describe('TransactionRetryService', () => {
  let service: TransactionRetryService;
  beforeEach(() => (service = new TransactionRetryService()));

  it('retries transient failures and succeeds', async () => {
    let calls = 0;
    const work = jest.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error('timeout');
      return 'tx123';
    });

    const res = await service.runWithRetry(work, 3, 1);
    expect(res.success).toBe(true);
    expect(res.txId).toBe('tx123');
    expect(res.attempts).toBe(2);
  });

  it('fails on permanent errors without retrying all attempts', async () => {
    const work = jest.fn(async () => {
      throw new Error('invalid signature');
    });
    const res = await service.runWithRetry(work, 3, 1);
    expect(res.success).toBe(false);
    expect(res.attempts).toBe(1);
  });
});
