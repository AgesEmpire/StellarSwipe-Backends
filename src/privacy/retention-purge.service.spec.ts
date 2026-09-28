import { RetentionPurgeService } from './retention-purge.service';
import { Repository } from 'typeorm';

describe('RetentionPurgeService', () => {
  it('purges eligible deleted users and leaves recent ones', async () => {
    const mockRepo: any = {
      find: jest.fn().mockResolvedValue([
        { id: '1', deletedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 40), email: 'a@x.com', displayName: 'A', bio: 'x' }, // 40 days
        { id: '2', deletedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10), email: 'b@x.com', displayName: 'B', bio: 'y' }, // 10 days
      ]),
      save: jest.fn().mockImplementation(async (u) => u),
    } as unknown as Repository<any>;

    const config: any = { get: () => 30 };
    const service = new RetentionPurgeService(mockRepo, config as any);
    const count = await service.purgeNowForTesting(30);
    expect(count).toBe(1);
    expect(mockRepo.save).toHaveBeenCalledTimes(1);
  });
});
