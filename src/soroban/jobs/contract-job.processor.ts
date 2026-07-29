import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import { SorobanService } from '../soroban.service';
import { ContractJobEntity, ContractJobStatus } from './contract-job.entity';
import { CONTRACT_JOB_QUEUE, CONTRACT_JOB_PROCESS } from './contract-job.constants';

export interface ContractJobPayload {
  entityId: string;
  contractId: string;
  method: string;
  params: unknown[];
  options: Record<string, unknown>;
}

@Processor(CONTRACT_JOB_QUEUE)
export class ContractJobProcessor {
  private readonly logger = new Logger(ContractJobProcessor.name);

  constructor(
    private readonly sorobanService: SorobanService,
    @InjectRepository(ContractJobEntity)
    private readonly jobRepo: Repository<ContractJobEntity>,
  ) {}

  @Process(CONTRACT_JOB_PROCESS)
  async handleContractJob(job: Job<ContractJobPayload>): Promise<void> {
    const { entityId, contractId, method, params, options } = job.data;

    await this.jobRepo.update(entityId, {
      status: ContractJobStatus.PROCESSING,
      attempts: job.attemptsMade + 1,
    });

    const result = await this.sorobanService.invokeContract(
      contractId,
      method,
      params,
      options as any,
    );

    await this.jobRepo.update(entityId, {
      status: ContractJobStatus.COMPLETED,
      txHash: result.hash ?? null,
      result,
      error: null,
    });
  }

  @OnQueueFailed()
  async onFailed(job: Job<ContractJobPayload>, error: Error): Promise<void> {
    const { entityId } = job.data;
    const isExhausted = job.attemptsMade >= (job.opts.attempts ?? 1);

    this.logger.error(
      `Contract job ${entityId} failed (attempt ${job.attemptsMade}): ${error.message}`,
    );

    await this.jobRepo.update(entityId, {
      status: isExhausted ? ContractJobStatus.DEAD_LETTERED : ContractJobStatus.FAILED,
      error: error.message,
      attempts: job.attemptsMade,
    });
  }

  @OnQueueCompleted()
  onCompleted(job: Job<ContractJobPayload>): void {
    this.logger.log(`Contract job ${job.data.entityId} completed successfully`);
  }
}
