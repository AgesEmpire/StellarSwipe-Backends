import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job, JobStatus } from './entities/job.entity';

const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
const DRAIN_POLL_INTERVAL_MS = 100;

@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private draining = false;
  private readonly activeJobs = new Set<string>();

  constructor(
    @InjectRepository(Job)
    private readonly jobRepository: Repository<Job>,
  ) {}

  /**
   * Whether the queue is currently accepting new jobs. Once draining has
   * started, intake is paused and no new jobs will be picked up.
   */
  isAcceptingJobs(): boolean {
    return !this.draining;
  }

  /**
   * Pause queue intake so no new jobs are picked up. Idempotent.
   */
  pauseIntake(): void {
    if (this.draining) {
      return;
    }
    this.draining = true;
    this.logger.log('Queue intake paused; draining active jobs');
  }

  /**
   * Pick up the next pending job. Returns null while draining so that no new
   * work is started during shutdown.
   */
  async dequeue(): Promise<Job | null> {
    if (this.draining) {
      return null;
    }

    const job = await this.jobRepository.findOne({
      where: { status: JobStatus.PENDING },
      order: { createdAt: 'ASC' },
    });

    if (!job) {
      return null;
    }

    job.status = JobStatus.RUNNING;
    await this.jobRepository.save(job);
    this.activeJobs.add(job.id);
    return job;
  }

  /**
   * Mark a job as completed and stop tracking it as active.
   */
  async complete(job: Job): Promise<void> {
    job.status = JobStatus.COMPLETED;
    await this.jobRepository.save(job);
    this.activeJobs.delete(job.id);
  }

  /**
   * Return a job to the queue so it remains recoverable. Used when a job
   * fails or when the drain timeout is exceeded.
   */
  async requeue(job: Job): Promise<void> {
    job.status = JobStatus.PENDING;
    await this.jobRepository.save(job);
    this.activeJobs.delete(job.id);
  }

  /**
   * Wait for active jobs to finish, bounded by the drain timeout. Jobs that
   * are still running when the timeout elapses are returned to the queue so
   * they remain recoverable rather than being marked complete.
   */
  async drain(timeoutMs: number = DEFAULT_DRAIN_TIMEOUT_MS): Promise<void> {
    this.pauseIntake();

    const deadline = Date.now() + timeoutMs;
    while (this.activeJobs.size > 0 && Date.now() < deadline) {
      await this.sleep(DRAIN_POLL_INTERVAL_MS);
    }

    if (this.activeJobs.size === 0) {
      this.logger.log('All active jobs drained successfully');
      return;
    }

    this.logger.warn(
      `Drain timeout reached with ${this.activeJobs.size} job(s) still running; requeueing for recovery`,
    );

    const stuckIds = Array.from(this.activeJobs);
    for (const id of stuckIds) {
      const job = await this.jobRepository.findOne({ where: { id } });
      if (job && job.status === JobStatus.RUNNING) {
        await this.requeue(job);
      } else {
        this.activeJobs.delete(id);
      }
    }
  }

  /**
   * Nest lifecycle hook: pause intake and drain active jobs on shutdown.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.drain();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
