import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import { ContractJobEntity, ContractJobStatus } from './contract-job.entity';
import { EnqueueContractJobDto } from './contract-job.dto';
import {
  CONTRACT_JOB_QUEUE,
  CONTRACT_JOB_PROCESS,
  CONTRACT_JOB_MAX_ATTEMPTS,
  CONTRACT_JOB_BACKOFF_MS,
} from './contract-job.constants';
import { ContractJobPayload } from './contract-job.processor';

@Injectable()
export class ContractJobService {
  private readonly logger = new Logger(ContractJobService.name);

  constructor(
    @InjectQueue(CONTRACT_JOB_QUEUE)
    private readonly queue: Queue<ContractJobPayload>,
    @InjectRepository(ContractJobEntity)
    private readonly jobRepo: Repository<ContractJobEntity>,
  ) {}

  async enqueue(dto: EnqueueContractJobDto): Promise<ContractJobEntity> {
    const { contractId, method, params = [], sourceSecret, sourceAccount, timeoutMs } = dto;

    const entity = this.jobRepo.create({
      contractId,
      method,
      params,
      options: { sourceSecret, sourceAccount, timeoutMs },
      status: ContractJobStatus.PENDING,
    });

    await this.jobRepo.save(entity);

    const bullJob = await this.queue.add(
      CONTRACT_JOB_PROCESS,
      {
        entityId: entity.id,
        contractId,
        method,
        params,
        options: { sourceSecret, sourceAccount, timeoutMs },
      },
      {
        priority: 10, // HIGH — contract interactions / limit orders
        attempts: CONTRACT_JOB_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: CONTRACT_JOB_BACKOFF_MS },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    await this.jobRepo.update(entity.id, { bullJobId: String(bullJob.id) });
    this.logger.log(`Enqueued contract job ${entity.id} (bull: ${bullJob.id})`);

    return { ...entity, bullJobId: String(bullJob.id) };
  }

  async getJob(id: string): Promise<ContractJobEntity> {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException(`Contract job ${id} not found`);
    return job;
  }

  async listJobs(status?: ContractJobStatus): Promise<ContractJobEntity[]> {
    return this.jobRepo.find({
      where: status ? { status } : undefined,
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }
}
