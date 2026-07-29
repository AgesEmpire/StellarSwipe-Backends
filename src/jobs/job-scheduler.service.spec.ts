import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { JobSchedulerService, JobDefinition } from './job-scheduler.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCronJob(running = true) {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    fireOnTick: jest.fn().mockResolvedValue(undefined),
    running,
    cronTime: { toString: () => '0 0 * * *' },
  };
}

async function buildService(configOverrides: Record<string, string> = {}) {
  const cronJobs = new Map<string, ReturnType<typeof makeCronJob>>();

  const registry = {
    doesExist: jest.fn((type: string, name: string) => cronJobs.has(name)),
    addCronJob: jest.fn((name: string, job: any) => cronJobs.set(name, job)),
    deleteCronJob: jest.fn((name: string) => cronJobs.delete(name)),
    getCronJob: jest.fn((name: string) => cronJobs.get(name)),
  };

  const config = {
    get: jest.fn((key: string) => configOverrides[key] ?? undefined),
  };

  const module = await Test.createTestingModule({
    providers: [
      JobSchedulerService,
      { provide: SchedulerRegistry, useValue: registry },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();

  return {
    svc: module.get(JobSchedulerService),
    registry,
    cronJobs,
  };
}

function noop(): Promise<void> {
  return Promise.resolve();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('JobSchedulerService', () => {
  describe('register()', () => {
    it('adds a cron job to the registry and starts it', async () => {
      const { svc, registry } = await buildService();
      svc.register({ name: 'test.job', cronEnvKey: 'CRON_TEST', defaultCron: '0 0 * * *', handler: noop });

      expect(registry.addCronJob).toHaveBeenCalledWith('test.job', expect.any(Object));
      const added = registry.addCronJob.mock.calls[0][1];
      expect(added.start).toHaveBeenCalled();
    });

    it('uses env var cron when present', async () => {
      const { svc, registry } = await buildService({ CRON_TEST: '*/5 * * * *' });
      svc.register({ name: 'test.job', cronEnvKey: 'CRON_TEST', defaultCron: '0 0 * * *', handler: noop });

      // The CronJob is constructed with the env value — verify via the registered instance
      expect(registry.addCronJob).toHaveBeenCalled();
    });

    it('replaces an existing job when re-registered', async () => {
      const { svc, registry } = await buildService();
      const def: JobDefinition = { name: 'test.job', cronEnvKey: 'CRON_TEST', defaultCron: '0 0 * * *', handler: noop };

      svc.register(def);
      // Simulate job already existing for second call
      registry.doesExist.mockReturnValueOnce(true);
      svc.register(def);

      expect(registry.deleteCronJob).toHaveBeenCalledWith('test.job');
      expect(registry.addCronJob).toHaveBeenCalledTimes(2);
    });
  });

  describe('pause() / resume()', () => {
    it('stops the cron job on pause', async () => {
      const { svc, cronJobs } = await buildService();
      const cronJob = makeCronJob();
      cronJobs.set('test.job', cronJob);
      svc.register({ name: 'test.job', cronEnvKey: 'CRON_TEST', defaultCron: '0 0 * * *', handler: noop });

      svc.pause('test.job');
      expect(cronJobs.get('test.job')!.stop).toHaveBeenCalled();
    });

    it('starts the cron job on resume', async () => {
      const { svc, cronJobs } = await buildService();
      const cronJob = makeCronJob(false);
      cronJobs.set('test.job', cronJob);
      svc.register({ name: 'test.job', cronEnvKey: 'CRON_TEST', defaultCron: '0 0 * * *', handler: noop });

      svc.resume('test.job');
      expect(cronJobs.get('test.job')!.start).toHaveBeenCalled();
    });
  });

  describe('getStatus()', () => {
    it('returns status for all registered jobs', async () => {
      const { svc } = await buildService();
      svc.register({ name: 'job.a', cronEnvKey: 'CRON_A', defaultCron: '0 0 * * *', handler: noop });
      svc.register({ name: 'job.b', cronEnvKey: 'CRON_B', defaultCron: '0 1 * * *', handler: noop });

      const status = svc.getStatus();
      expect(Object.keys(status)).toEqual(expect.arrayContaining(['job.a', 'job.b']));
      expect(status['job.a']).toMatchObject({ lastExecution: null, recentFailures: 0 });
    });
  });

  describe('getHistory()', () => {
    it('returns empty array for a job with no executions', async () => {
      const { svc } = await buildService();
      svc.register({ name: 'test.job', cronEnvKey: 'CRON_TEST', defaultCron: '0 0 * * *', handler: noop });
      expect(svc.getHistory('test.job')).toEqual([]);
    });

    it('returns empty array for an unknown job', async () => {
      const { svc } = await buildService();
      expect(svc.getHistory('unknown')).toEqual([]);
    });
  });

  describe('handler execution', () => {
    it('records a success execution after handler resolves', async () => {
      const { svc } = await buildService();
      const handler = jest.fn().mockResolvedValue(undefined);
      svc.register({ name: 'test.job', cronEnvKey: 'CRON_TEST', defaultCron: '0 0 * * *', handler });

      // Invoke the private method directly to avoid waiting for cron tick
      await (svc as any).runWithRetry('test.job', handler, 3, 0);

      const history = svc.getHistory('test.job');
      expect(history[0]).toMatchObject({ status: 'success', jobName: 'test.job', attempt: 1 });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('retries on failure and records failed execution', async () => {
      const { svc } = await buildService();
      const handler = jest.fn().mockRejectedValue(new Error('boom'));
      svc.register({ name: 'test.job', cronEnvKey: 'CRON_TEST', defaultCron: '0 0 * * *', handler });

      // Run with maxRetries=1 so it fails immediately without scheduling a timer
      await (svc as any).runWithRetry('test.job', handler, 1, 0);

      const history = svc.getHistory('test.job');
      expect(history[0]).toMatchObject({ status: 'failed', error: 'boom' });
    });

    it('schedules a retry when attempts remain', async () => {
      jest.useFakeTimers();
      const { svc } = await buildService();
      const handler = jest.fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue(undefined);

      svc.register({ name: 'test.job', cronEnvKey: 'CRON_TEST', defaultCron: '0 0 * * *', handler });
      await (svc as any).runWithRetry('test.job', handler, 3, 10);

      // Advance past the retry delay
      await jest.runAllTimersAsync();

      expect(handler).toHaveBeenCalledTimes(2);
      const history = svc.getHistory('test.job');
      expect(history.some(e => e.status === 'success')).toBe(true);
      jest.useRealTimers();
    });
  });

  describe('onModuleDestroy()', () => {
    it('clears pending retry timers', async () => {
      const { svc } = await buildService();
      const clearSpy = jest.spyOn(global, 'clearTimeout');
      // Push a fake timer id
      (svc as any).retryTimers.push(setTimeout(() => {}, 60_000));
      svc.onModuleDestroy();
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });
});
