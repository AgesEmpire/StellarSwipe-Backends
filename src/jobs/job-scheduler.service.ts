import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ConfigService } from '@nestjs/config';

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
}

export interface JobExecution {
  jobName: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success' | 'failed';
  error?: string;
  attempt: number;
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
 *  - Retries failed handlers with exponential backoff before marking failed.
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

    const job = new CronJob(cron, () => {
      void this.runWithRetry(def.name, def.handler, maxRetries, retryDelayMs);
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
      exec.finishedAt = new Date().toISOString();
      this.logger.log(`Job "${name}" completed (attempt ${attempt})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      exec.finishedAt = new Date().toISOString();

      if (attempt < maxRetries) {
        exec.status = 'failed';
        exec.error = `${message} — retrying (${attempt}/${maxRetries})`;
        this.logger.warn(`Job "${name}" failed (attempt ${attempt}/${maxRetries}): ${message}`);

        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        const timer = setTimeout(
          () => void this.runWithRetry(name, handler, maxRetries, baseDelayMs, attempt + 1),
          delay,
        );
        this.retryTimers.push(timer);
      } else {
        exec.status = 'failed';
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
