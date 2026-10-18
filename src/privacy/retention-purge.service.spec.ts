import { RetentionPurgeService } from './retention-purge.service';
import { Repository } from 'typeorm';

describe('RetentionPurgeService', () => {
  const eligibleUser = {
    id: 'user-0000000000001',
    deletedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 40), // 40 days
    email: 'a@x.com',
    displayName: 'A',
    bio: 'x',
  };
  const recentUser = {
    id: 'user-0000000000002',
    deletedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10), // 10 days
    email: 'b@x.com',
    displayName: 'B',
    bio: 'y',
  };

  function buildMockRepo() {
    return {
      find: jest.fn().mockResolvedValue([{ ...eligibleUser }, { ...recentUser }]),
      save: jest.fn().mockImplementation(async (u) => u),
    } as unknown as Repository<any>;
  }

  it('purges eligible deleted users and leaves recent ones', async () => {
    const mockRepo = buildMockRepo();
    const config: any = { get: () => 30 };
    const service = new RetentionPurgeService(mockRepo, config as any);
    const count = await service.purgeNowForTesting(30);
    expect(count).toBe(1);
    expect(mockRepo.save).toHaveBeenCalledTimes(1);
  });

  describe('dry-run mode', () => {
    it('reports eligible records without mutating anything', async () => {
      const mockRepo = buildMockRepo();
      const config: any = { get: () => 30 };
      const service = new RetentionPurgeService(mockRepo, config as any);

      const report = await service.previewPurge(30);

      expect(report.dryRun).toBe(true);
      expect(report.eligibleCount).toBe(1);
      expect(report.purgedCount).toBe(0);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('never includes raw sensitive fields in the report', async () => {
      const mockRepo = buildMockRepo();
      const config: any = { get: () => 30 };
      const service = new RetentionPurgeService(mockRepo, config as any);

      const report = await service.previewPurge(30);
      const serialized = JSON.stringify(report);

      expect(serialized).not.toContain(eligibleUser.email);
      expect(serialized).not.toContain(eligibleUser.id);
      expect(report.eligibleIdentifiers).toHaveLength(1);
      expect(report.eligibleIdentifiers[0]).not.toBe(eligibleUser.id);
    });

    it('matches the count a real purge would perform', async () => {
      const previewRepo = buildMockRepo();
      const realRepo = buildMockRepo();
      const config: any = { get: () => 30 };

      const previewService = new RetentionPurgeService(previewRepo, config as any);
      const realService = new RetentionPurgeService(realRepo, config as any);

      const report = await previewService.previewPurge(30);
      const purgedCount = await realService.purgeNowForTesting(30);

      expect(report.eligibleCount).toBe(purgedCount);
    });
  });
});
