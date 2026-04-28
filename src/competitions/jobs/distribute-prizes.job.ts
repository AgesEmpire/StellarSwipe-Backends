import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Competition, CompetitionStatus } from '../entities/competition.entity';
import {
  COMPETITIONS_QUEUE,
  COMPETITION_JOB_DISTRIBUTE_PRIZES,
} from './competitions-queue.constant';

@Injectable()
@Processor(COMPETITIONS_QUEUE)
export class DistributePrizesJob implements OnModuleInit {
  private readonly logger = new Logger(DistributePrizesJob.name);

  constructor(
    @InjectQueue(COMPETITIONS_QUEUE) private readonly queue: Queue,
    @InjectRepository(Competition)
    private readonly competitionRepository: Repository<Competition>,
  ) {}

  async onModuleInit(): Promise<void> {
    const jobs = await this.queue.getRepeatableJobs();
    const exists = jobs.find((j) => j.id === 'competitions-distribute-prizes');
    if (!exists) {
      await this.queue.add(
        COMPETITION_JOB_DISTRIBUTE_PRIZES,
        {},
        {
          jobId: 'competitions-distribute-prizes',
          repeat: { every: 120_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      this.logger.log('Registered repeatable prize distribution scan (120s)');
    }
  }

  @Process(COMPETITION_JOB_DISTRIBUTE_PRIZES)
  async handle(_job: Job): Promise<void> {
    const pending = await this.competitionRepository.find({
      where: { status: CompetitionStatus.ENDED },
      relations: ['prizePool'],
    });
    for (const c of pending) {
      if (!c.prizePool?.distributedAt) {
        this.logger.log(`Prize distribution pending for competition ${c.id} (integrate payouts)`);
      }
    }
  }
}
