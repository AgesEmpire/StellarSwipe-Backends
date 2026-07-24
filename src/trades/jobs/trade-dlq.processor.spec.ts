import { Test, TestingModule } from '@nestjs/testing';
import { TradeDlqProcessor } from './trade-dlq.processor';

describe('TradeDlqProcessor', () => {
  let processor: TradeDlqProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TradeDlqProcessor],
    }).compile();

    processor = module.get(TradeDlqProcessor);
  });

  const makeJob = (attemptsMade: number, attempts: number) =>
    ({
      id: 'job-1',
      name: 'check-statuses',
      attemptsMade,
      opts: { attempts },
    }) as any;

  it('logs a dead-letter error once all attempts are exhausted', () => {
    const errorSpy = jest.spyOn((processor as any).logger, 'error').mockImplementation();

    processor.onFailed(makeJob(3, 3), new Error('Horizon RPC unreachable'));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('exhausted all 3 attempts');
  });

  it('does not log a dead-letter error while retries remain', () => {
    const errorSpy = jest.spyOn((processor as any).logger, 'error').mockImplementation();

    processor.onFailed(makeJob(1, 3), new Error('transient failure'));

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('treats a missing attempts option as a single-attempt job', () => {
    const errorSpy = jest.spyOn((processor as any).logger, 'error').mockImplementation();

    processor.onFailed({ id: 'job-2', name: 'check-statuses', attemptsMade: 1, opts: {} } as any, new Error('boom'));

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
