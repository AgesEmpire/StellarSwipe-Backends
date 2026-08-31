import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ConfigService } from '@nestjs/config';
import { computeBackoffDelayMs, isPermanentJobError } from '../common/retry';

export interface JobDefinition {
  /** Unique name used as the key in SchedulerRegistry */
  name: string;
  /** Env var name for the cron expression (falls back to defaultCron) */
  cronEnvKey: string;
  /** Default cron expression when env var is absent */
  defaultCron: string;
  /** The async function to execute */
  handler: () => Promise<void>;
  /** Max retry attempts on failure (default 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default 5000) */
  retryDelayMs?: number;
  /** Upper bound in ms on the computed backoff delay (default 60000) */
  maxRetryDelayMs?: number;
  /**
   * Jitter strategy applied to the computed backoff delay: "full" (default)
   * picks a random delay in [0, backoff] to avoid synchronized retry storms
   * across job instances; "none" disables randomization (useful in tests).
   */
  jitter?: 'full' | 'none';
}

export interface JobExecution {
  jobName: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success' | 'failed';
  error?: string;
  attempt: number;
  /**
   * Final disposition of this attempt, set once the job settles:
   * "success" — handler resolved; "permanent-failure" — a non-retryable
   * error short-circuited retries; "retries-exhausted" — every attempt
   * failed with a retryable error. Left undefined while a retry is still
   * pending (the failure isn't final yet).
   */
  outcome?: 'success' | 'permanent-failure' | 'retries-exhausted';
}

/**
 * JobSchedulerService — central orchestrator for all cron-based jobs.
 *
 * Features:
 *  - Registers jobs with NestJS SchedulerRegistry so they appear in the
 *    standard scheduler and can be paused/resumed programmatically.
 *  - Cron expressions are read from environment variables, falling back to
 *    hardcoded defaults — no code change needed to reschedule.
 *  - Tracks the last N executions per job (in-memory ring buffer, size 20).
 *  - Retries failed handlers with jittered exponential backoff (capped at
 *    `maxRetryDelayMs`, computed via the shared `computeBackoffDelayMs`
 *    from `src/common/retry`) before marking the job permanently failed.
 *  - Classifies handler errors via `isPermanentJobError`: a permanent
 *    failure (bad input, auth, not-found, or an explicit `PermanentError`)
 *    short-circuits retries immediately instead of burning through
 *    `maxRetries` on an error that will never succeed.
 */
@Injectable()
export class JobSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(JobSchedulerService.name);
  private readonly executions = new Map<string, JobExecution[]>();
  private readonly retryTimers: ReturnType<typeof setTimeout>[] = [];
  private readonly MAX_HISTORY = 20;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly config: ConfigService,
  ) {}

  /**
   * Register a job. Call this from module `onModuleInit` hooks.
   * Idempotent — re-registration replaces the existing cron.
   */
  register(def: JobDefinition): void {
    const cron = this.config.get<string>(def.cronEnvKey) ?? def.defaultCron;
    const maxRetries = def.maxRetries ?? 3;
    const retryDelayMs = def.retryDelayMs ?? 5_000;
    const maxRetryDelayMs = def.maxRetryDelayMs ?? 60_000;
    const jitter = def.jitter ?? 'full';

    const job = new CronJob(cron, () => {
      void this.runWithRetry(
        def.name,
        def.handler,
        maxRetries,
        retryDelayMs,
        1,
        maxRetryDelayMs,
        jitter,
      );
    });

    // Replace if already registered
    if (this.schedulerRegistry.doesExist('cron', def.name)) {
      this.schedulerRegistry.deleteCronJob(def.name);
    }
    this.schedulerRegistry.addCronJob(def.name, job);
    job.start();

    this.executions.set(def.name, []);
    this.logger.log(`Registered job "${def.name}" with cron "${cron}"`);
  }

  /** Trigger a registered job immediately (outside its schedule). */
  async triggerNow(name: string): Promise<void> {
    const job = this.schedulerRegistry.getCronJob(name);
    if (!job) throw new Error(`Job "${name}" not registered`);
    await job.fireOnTick();
  }

  /** Pause a registered job. */
  pause(name: string): void {
    this.schedulerRegistry.getCronJob(name).stop();
    this.logger.log(`Job "${name}" paused`);
  }

  /** Resume a paused job. */
  resume(name: string): void {
    this.schedulerRegistry.getCronJob(name).start();
    this.logger.log(`Job "${name}" resumed`);
  }

  /** Snapshot of all registered jobs and their last execution. */
  getStatus(): Record<string, { cron: string; running: boolean; lastExecution: JobExecution | null; recentFailures: number }> {
    const result: ReturnType<typeof this.getStatus> = {};

    for (const [name, history] of this.executions) {
      const cronJob = this.schedulerRegistry.getCronJob(name);
      const last = history.at(-1) ?? null;
      const recentFailures = history.filter(e => e.status === 'failed').length;

      result[name] = {
        cron: cronJob.cronTime.toString(),
        running: cronJob.running ?? false,
        lastExecution: last,
        recentFailures,
      };
    }

    return result;
  }

  /** Execution history for a single job (most recent first). */
  getHistory(name: string): JobExecution[] {
    return [...(this.executions.get(name) ?? [])].reverse();
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private async runWithRetry(
    name: string,
    handler: () => Promise<void>,
    maxRetries: number,
    baseDelayMs: number,
    attempt = 1,
    maxRetryDelayMs = 60_000,
    jitter: 'full' | 'none' = 'full',
  ): Promise<void> {
    const exec: JobExecution = {
      jobName: name,
      startedAt: new Date().toISOString(),
      status: 'running',
      attempt,
    };
    this.pushExecution(name, exec);

    try {
      await handler();
      exec.status = 'success';
      exec.outcome = 'success';
      exec.finishedAt = new Date().toISOString();
      this.logger.log(`Job "${name}" completed (attempt ${attempt})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      exec.finishedAt = new Date().toISOString();

      // Permanent failures (bad input, auth, not-found, or an explicit
      // PermanentError) will not succeed on retry — stop immediately
      // rather than burning through maxRetries.
      if (isPermanentJobError(err)) {
        exec.status = 'failed';
        exec.outcome = 'permanent-failure';
        exec.error = message;
        this.logger.error(
          `Job "${name}" failed permanently on attempt ${attempt}, not retrying: ${message}`,
        );
        return;
      }

      if (attempt < maxRetries) {
        exec.status = 'failed';
        const delay = computeBackoffDelayMs(attempt, baseDelayMs, maxRetryDelayMs, jitter);
        exec.error = `${message} — retrying (${attempt}/${maxRetries}) in ${delay}ms`;
        this.logger.warn(
          `Job "${name}" failed (attempt ${attempt}/${maxRetries}): ${message}; retrying in ${delay}ms`,
        );

        const timer = setTimeout(
          () =>
            void this.runWithRetry(
              name,
              handler,
              maxRetries,
              baseDelayMs,
              attempt + 1,
              maxRetryDelayMs,
              jitter,
            ),
          delay,
        );
        this.retryTimers.push(timer);
      } else {
        exec.status = 'failed';
        exec.outcome = 'retries-exhausted';
        exec.error = message;
        this.logger.error(`Job "${name}" exhausted ${maxRetries} attempts: ${message}`);
      }
    }
  }

  private pushExecution(name: string, exec: JobExecution): void {
    const history = this.executions.get(name) ?? [];
    history.push(exec);
    if (history.length > this.MAX_HISTORY) history.shift();
    this.executions.set(name, history);
  }

  onModuleDestroy(): void {
    for (const t of this.retryTimers) clearTimeout(t);
  }
}
