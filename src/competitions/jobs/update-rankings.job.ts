import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { CompetitionService } from '../competition.service';
import {
  COMPETITIONS_QUEUE,
  COMPETITION_JOB_UPDATE_RANKINGS,
} from './competitions-queue.constant';

@Injectable()
@Processor(COMPETITIONS_QUEUE)
export class UpdateRankingsJob implements OnModuleInit {
  private readonly logger = new Logger(UpdateRankingsJob.name);

  constructor(
    @InjectQueue(COMPETITIONS_QUEUE) private readonly queue: Queue,
    private readonly competitionService: CompetitionService,
  ) {}

  async onModuleInit(): Promise<void> {
    const jobs = await this.queue.getRepeatableJobs();
    const exists = jobs.find((j) => j.id === 'competitions-update-rankings');
    if (!exists) {
      await this.queue.add(
        COMPETITION_JOB_UPDATE_RANKINGS,
        {},
        {
          jobId: 'competitions-update-rankings',
          repeat: { every: 60_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      this.logger.log('Registered repeatable competition ranking job (60s)');
    }
  }

  @Process(COMPETITION_JOB_UPDATE_RANKINGS)
  async handle(_job: Job): Promise<void> {
    await this.competitionService.updateRankingsForLiveCompetitions();
  }
}
