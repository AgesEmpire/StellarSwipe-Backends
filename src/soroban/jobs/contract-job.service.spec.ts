import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ContractJobService } from './contract-job.service';
import { ContractJobProcessor, ContractJobPayload } from './contract-job.processor';
import { ContractJobEntity, ContractJobStatus } from './contract-job.entity';
import { CONTRACT_JOB_QUEUE } from './contract-job.constants';
import { SorobanService } from '../soroban.service';

const mockRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
});

const mockQueue = () => ({
  add: jest.fn(),
});

const mockSoroban = () => ({
  invokeContract: jest.fn(),
});

describe('ContractJobService', () => {
  let service: ContractJobService;
  let repo: ReturnType<typeof mockRepo>;
  let queue: ReturnType<typeof mockQueue>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractJobService,
        { provide: getRepositoryToken(ContractJobEntity), useFactory: mockRepo },
        { provide: getQueueToken(CONTRACT_JOB_QUEUE), useFactory: mockQueue },
      ],
    }).compile();

    service = module.get(ContractJobService);
    repo = module.get(getRepositoryToken(ContractJobEntity));
    queue = module.get(getQueueToken(CONTRACT_JOB_QUEUE));
  });

  describe('enqueue', () => {
    it('persists entity and adds bull job', async () => {
      const entity = { id: 'uuid-1', bullJobId: null } as ContractJobEntity;
      repo.create.mockReturnValue(entity);
      repo.save.mockResolvedValue(entity);
      queue.add.mockResolvedValue({ id: 'bull-1' });
      repo.update.mockResolvedValue(undefined);

      const result = await service.enqueue({
        contractId: 'C123',
        method: 'transfer',
        params: [],
        sourceSecret: 'S...',
      });

      expect(repo.save).toHaveBeenCalledWith(entity);
      expect(queue.add).toHaveBeenCalledWith(
        'invoke-contract',
        expect.objectContaining({ entityId: 'uuid-1', contractId: 'C123' }),
        expect.objectContaining({ attempts: 3 }),
      );
      expect(repo.update).toHaveBeenCalledWith('uuid-1', { bullJobId: 'bull-1' });
      expect(result.bullJobId).toBe('bull-1');
    });
  });

  describe('getJob', () => {
    it('returns entity when found', async () => {
      const entity = { id: 'uuid-1' } as ContractJobEntity;
      repo.findOne.mockResolvedValue(entity);
      await expect(service.getJob('uuid-1')).resolves.toBe(entity);
    });

    it('throws NotFoundException when not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getJob('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listJobs', () => {
    it('returns jobs filtered by status', async () => {
      repo.find.mockResolvedValue([]);
      await service.listJobs(ContractJobStatus.PENDING);
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: ContractJobStatus.PENDING } }),
      );
    });
  });
});

describe('ContractJobProcessor', () => {
  let processor: ContractJobProcessor;
  let soroban: ReturnType<typeof mockSoroban>;
  let repo: ReturnType<typeof mockRepo>;

  const makeJob = (overrides: Partial<ContractJobPayload> = {}, opts = {}) =>
    ({
      data: {
        entityId: 'uuid-1',
        contractId: 'C123',
        method: 'transfer',
        params: [],
        options: { sourceSecret: 'S...' },
        ...overrides,
      },
      attemptsMade: 0,
      opts: { attempts: 3, ...opts },
    }) as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractJobProcessor,
        { provide: SorobanService, useFactory: mockSoroban },
        { provide: getRepositoryToken(ContractJobEntity), useFactory: mockRepo },
      ],
    }).compile();

    processor = module.get(ContractJobProcessor);
    soroban = module.get(SorobanService);
    repo = module.get(getRepositoryToken(ContractJobEntity));
  });

  describe('handleContractJob', () => {
    it('marks job COMPLETED and stores result on success', async () => {
      const contractResult = { success: true, hash: 'abc123', status: 'SUCCESS' };
      soroban.invokeContract.mockResolvedValue(contractResult);
      repo.update.mockResolvedValue(undefined);

      await processor.handleContractJob(makeJob());

      expect(repo.update).toHaveBeenCalledWith(
        'uuid-1',
        expect.objectContaining({ status: ContractJobStatus.PROCESSING }),
      );
      expect(repo.update).toHaveBeenCalledWith(
        'uuid-1',
        expect.objectContaining({
          status: ContractJobStatus.COMPLETED,
          txHash: 'abc123',
          result: contractResult,
        }),
      );
    });

    it('propagates error so Bull can retry', async () => {
      soroban.invokeContract.mockRejectedValue(new Error('network error'));
      repo.update.mockResolvedValue(undefined);

      await expect(processor.handleContractJob(makeJob())).rejects.toThrow('network error');
    });
  });

  describe('onFailed', () => {
    it('marks FAILED when attempts remain', async () => {
      repo.update.mockResolvedValue(undefined);
      const job = makeJob({}, { attempts: 3 });
      job.attemptsMade = 1;

      await processor.onFailed(job, new Error('timeout'));

      expect(repo.update).toHaveBeenCalledWith(
        'uuid-1',
        expect.objectContaining({ status: ContractJobStatus.FAILED }),
      );
    });

    it('dead-letters job when all attempts exhausted', async () => {
      repo.update.mockResolvedValue(undefined);
      const job = makeJob({}, { attempts: 3 });
      job.attemptsMade = 3;

      await processor.onFailed(job, new Error('permanent failure'));

      expect(repo.update).toHaveBeenCalledWith(
        'uuid-1',
        expect.objectContaining({ status: ContractJobStatus.DEAD_LETTERED }),
      );
    });
  });
});
