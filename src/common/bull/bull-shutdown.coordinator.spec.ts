import { BullShutdownCoordinator } from './bull-shutdown.coordinator';

describe('BullShutdownCoordinator', () => {
  const prometheus = { bullShutdownForcedTotal: { inc: jest.fn() } };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BULL_SHUTDOWN_GRACE_PERIOD_MS;
  });

  it('pauses workers before gracefully closing them', async () => {
    const calls: string[] = [];
    const worker = {
      closed: false,
      pause: jest.fn(async () => { calls.push('pause'); }),
      close: jest.fn(async () => { calls.push('close'); worker.closed = true; }),
    };
    const coordinator = new BullShutdownCoordinator(prometheus as any);
    coordinator.register('orders', worker as any);

    await coordinator.onApplicationShutdown('SIGTERM');

    expect(calls).toEqual(['pause', 'close']);
    expect(prometheus.bullShutdownForcedTotal.inc).not.toHaveBeenCalled();
  });

  it('force-closes active workers after the configured grace period', async () => {
    process.env.BULL_SHUTDOWN_GRACE_PERIOD_MS = '10';
    const worker = {
      closed: false,
      pause: jest.fn().mockResolvedValue(undefined),
      close: jest.fn((force: boolean) => {
        if (force) {
          worker.closed = true;
          return Promise.resolve();
        }
        return new Promise<void>(() => undefined);
      }),
    };
    const coordinator = new BullShutdownCoordinator(prometheus as any);
    coordinator.register('orders', worker as any);

    await coordinator.onApplicationShutdown('SIGTERM');

    expect(worker.pause).toHaveBeenCalledWith(true);
    expect(worker.close).toHaveBeenNthCalledWith(1, false);
    expect(worker.close).toHaveBeenNthCalledWith(2, true);
    expect(prometheus.bullShutdownForcedTotal.inc).toHaveBeenCalledTimes(1);
  });

  it('keeps queued jobs in Redis by closing without force when active work drains', async () => {
    const worker = {
      closed: false,
      pause: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const coordinator = new BullShutdownCoordinator(prometheus as any);
    coordinator.register('settlement', worker as any);

    await coordinator.onApplicationShutdown();

    expect(worker.close).toHaveBeenCalledWith(false);
    expect(worker.close).not.toHaveBeenCalledWith(true);
  });
});
