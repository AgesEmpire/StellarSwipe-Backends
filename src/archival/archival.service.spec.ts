import { Test, TestingModule } from '@nestjs/testing';
import { ArchivalService } from './archival.service';
import { ArchivalRepository } from './archival.repository';
import { ArchivalConfig } from './archival.config';

describe('ArchivalService', () => {
  let service: ArchivalService;
  let repository: jest.Mocked<ArchivalRepository>;
  let config: ArchivalConfig;

  const now = new Date('2024-06-01T00:00:00.000Z');

  const buildRecord = (overrides: Partial<ArchivalRecord> = {}): ArchivalRecord => ({
    id: 'rec-1',
    deletedAt: new Date('2024-01-01T00:00:00.000Z'),
    legalHold: false,
    ...overrides,
  });

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(now);

    repository = {
      findSoftDeletedBefore: jest.fn(),
      archive: jest.fn(),
      markArchived: jest.fn(),
      recordFailure: jest.fn(),
    } as unknown as jest.Mocked<ArchivalRepository>;

    config = { retentionDays: 30, batchSize: 100 } as ArchivalConfig;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArchivalService,
        { provide: ArchivalRepository, useValue: repository },
        { provide: ArchivalConfig, useValue: config },
      ],
    }).compile();

    service = module.get<ArchivalService>(ArchivalService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('archives soft-deleted records past the retention window', async () => {
    const eligible = buildRecord({ id: 'rec-1' });
    repository.findSoftDeletedBefore.mockResolvedValue([eligible]);
    repository.archive.mockResolvedValue(undefined);
    repository.markArchived.mockResolvedValue(undefined);

    const result = await service.runArchivalSweep();

    expect(repository.findSoftDeletedBefore).toHaveBeenCalledWith(
      new Date('2024-05-02T00:00:00.000Z'),
      config.batchSize,
    );
    expect(repository.archive).toHaveBeenCalledWith(eligible);
    expect(repository.markArchived).toHaveBeenCalledWith(eligible.id);
    expect(result).toEqual({ archived: 1, skipped: 0, failed: 0 });
  });

  it('does not archive records still within the retention window', async () => {
    repository.findSoftDeletedBefore.mockResolvedValue([]);

    const result = await service.runArchivalSweep();

    expect(repository.archive).not.toHaveBeenCalled();
    expect(result).toEqual({ archived: 0, skipped: 0, failed: 0 });
  });

  it('skips records under legal hold regardless of retention eligibility', async () => {
    const held = buildRecord({ id: 'rec-held', legalHold: true });
    repository.findSoftDeletedBefore.mockResolvedValue([held]);

    const result = await service.runArchivalSweep();

    expect(repository.archive).not.toHaveBeenCalled();
    expect(repository.markArchived).not.toHaveBeenCalled();
    expect(result).toEqual({ archived: 0, skipped: 1, failed: 0 });
  });

  it('never archives active (non-soft-deleted) records', async () => {
    const active = buildRecord({ id: 'rec-active', deletedAt: null });
    repository.findSoftDeletedBefore.mockResolvedValue([active]);

    const result = await service.runArchivalSweep();

    expect(repository.archive).not.toHaveBeenCalled();
    expect(result).toEqual({ archived: 0, skipped: 1, failed: 0 });
  });

  it('is idempotent when a record has already been archived', async () => {
    const already = buildRecord({ id: 'rec-done', archivedAt: now });
    repository.findSoftDeletedBefore.mockResolvedValue([already]);

    const result = await service.runArchivalSweep();

    expect(repository.archive).not.toHaveBeenCalled();
    expect(result).toEqual({ archived: 0, skipped: 1, failed: 0 });
  });

  it('records failures and continues processing the remaining batch', async () => {
    const failing = buildRecord({ id: 'rec-fail' });
    const succeeding = buildRecord({ id: 'rec-ok' });
    repository.findSoftDeletedBefore.mockResolvedValue([failing, succeeding]);
    repository.archive
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined);
    repository.markArchived.mockResolvedValue(undefined);
    repository.recordFailure.mockResolvedValue(undefined);

    const result = await service.runArchivalSweep();

    expect(repository.recordFailure).toHaveBeenCalledWith(
      failing.id,
      expect.any(Error),
    );
    expect(repository.markArchived).toHaveBeenCalledWith(succeeding.id);
    expect(result).toEqual({ archived: 1, skipped: 0, failed: 1 });
  });

  it('retries transient archival failures before giving up', async () => {
    const flaky = buildRecord({ id: 'rec-flaky' });
    repository.findSoftDeletedBefore.mockResolvedValue([flaky]);
    repository.archive
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(undefined);
    repository.markArchived.mockResolvedValue(undefined);

    const result = await service.runArchivalSweep();

    expect(repository.archive).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ archived: 1, skipped: 0, failed: 0 });
  });

  it('exposes progress for the current sweep', async () => {
    repository.findSoftDeletedBefore.mockResolvedValue([
      buildRecord({ id: 'rec-1' }),
      buildRecord({ id: 'rec-2' }),
    ]);
    repository.archive.mockResolvedValue(undefined);
    repository.markArchived.mockResolvedValue(undefined);

    await service.runArchivalSweep();

    expect(service.getProgress()).toEqual({
      processed: 2,
      archived: 2,
      skipped: 0,
      failed: 0,
    });
  });
});
