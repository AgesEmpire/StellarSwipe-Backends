import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Process, Processor, InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { ScheduledTradesService } from '../scheduled-trades.service';

export const SCHEDULED_TRADES_QUEUE = 'scheduled-trades';

@Injectable()
@Processor(SCHEDULED_TRADES_QUEUE)
export class ExecuteScheduledTradesJob implements OnModuleInit {
  private readonly logger = new Logger(ExecuteScheduledTradesJob.name);

  constructor(
    @InjectQueue(SCHEDULED_TRADES_QUEUE)
    private readonly queue: Queue,
    private readonly scheduledTradesService: ScheduledTradesService,
  ) {}

  async onModuleInit(): Promise<void> {
    const jobs = await this.queue.getRepeatableJobs();
    const exists = jobs.find((j) => j.id === 'evaluate-scheduled-trades');

    if (!exists) {
      await this.queue.add(
        'evaluate',
        {},
        {
          jobId: 'evaluate-scheduled-trades',
          repeat: { every: 60 * 1000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      this.logger.log('Registered repeatable scheduled-trades evaluation job');
    }
  }

  @Process('evaluate')
  async handleEvaluation(_job: Job): Promise<void> {
    this.logger.debug('Running scheduled trades evaluation');
    await this.scheduledTradesService.evaluateScheduledTrades();
  }
}
