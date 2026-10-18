import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SearchReindexCheckpointService } from './search-reindex-checkpoint.service';
import { SearchReindexCheckpoint } from '../entities/search-reindex-checkpoint.entity';

describe('SearchReindexCheckpointService', () => {
  let service: SearchReindexCheckpointService;
  let repo: jest.Mocked<Repository<SearchReindexCheckpoint>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchReindexCheckpointService,
        {
          provide: getRepositoryToken(SearchReindexCheckpoint),
          useValue: {
            findOne: jest.fn(),
            upsert: jest.fn(),
            delete: jest.fn(),
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(SearchReindexCheckpointService);
    repo = module.get(getRepositoryToken(SearchReindexCheckpoint));
  });

  describe('resolveResumeOffset', () => {
    it('starts from zero when no checkpoint exists', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.resolveResumeOffset('signals', 500)).resolves.toBe(0);
    });

    it('starts from zero when the checkpoint is already completed', async () => {
      repo.findOne.mockResolvedValue({
        jobName: 'signals',
        processed: 500,
        total: 500,
        completedAt: new Date(),
        updatedAt: new Date(),
      } as SearchReindexCheckpoint);

      await expect(service.resolveResumeOffset('signals', 500)).resolves.toBe(0);
    });

    it('resumes from the persisted offset for a matching, incomplete job', async () => {
      repo.findOne.mockResolvedValue({
        jobName: 'signals',
        processed: 300,
        total: 500,
        completedAt: null,
        updatedAt: new Date(),
      } as SearchReindexCheckpoint);

      await expect(service.resolveResumeOffset('signals', 500)).resolves.toBe(300);
    });

    it('restarts from zero when the total has changed since the checkpoint was recorded', async () => {
      repo.findOne.mockResolvedValue({
        jobName: 'signals',
        processed: 300,
        total: 500,
        completedAt: null,
        updatedAt: new Date(),
      } as SearchReindexCheckpoint);

      await expect(service.resolveResumeOffset('signals', 650)).resolves.toBe(0);
    });
  });

  describe('saveProgress / markCompleted', () => {
    it('upserts progress keyed by job name', async () => {
      await service.saveProgress('signals', 200, 500);
      expect(repo.upsert).toHaveBeenCalledWith(
        { jobName: 'signals', processed: 200, total: 500, completedAt: null },
        ['jobName'],
      );
    });

    it('upserts completion with processed === total and a completedAt timestamp', async () => {
      await service.markCompleted('signals', 500);
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ jobName: 'signals', processed: 500, total: 500 }),
        ['jobName'],
      );
      const [[payload]] = repo.upsert.mock.calls;
      expect((payload as any).completedAt).toBeInstanceOf(Date);
    });
  });
});
