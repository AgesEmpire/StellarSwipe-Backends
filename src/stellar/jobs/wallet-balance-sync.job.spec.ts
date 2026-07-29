import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WalletBalanceSyncJob } from './wallet-balance-sync.job';
import { User } from '../../users/entities/user.entity';
import { AccountManagerService } from '../account/account-manager.service';

const mockUserRepo = () => ({
  createQueryBuilder: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
});

const mockAccountManager = () => ({
  getAccountInfo: jest.fn(),
});

const makeQb = (users: Partial<User>[]) => ({
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue(users),
});

describe('WalletBalanceSyncJob', () => {
  let job: WalletBalanceSyncJob;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let accountManager: ReturnType<typeof mockAccountManager>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletBalanceSyncJob,
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
        { provide: AccountManagerService, useFactory: mockAccountManager },
      ],
    }).compile();

    job = module.get(WalletBalanceSyncJob);
    userRepo = module.get(getRepositoryToken(User));
    accountManager = module.get(AccountManagerService);
  });

  describe('syncUserBalance', () => {
    it('detects a balance change and logs reconciliation', async () => {
      accountManager.getAccountInfo.mockResolvedValue({
        accountId: 'GABC',
        balances: [{ asset_type: 'native', balance: '200.0000000' }],
        subentryCount: 0,
        sequence: '1',
      });
      userRepo.findOne.mockResolvedValue({ walletAddress: 'GABC', xlmBalance: '100.0000000' });
      userRepo.update.mockResolvedValue({});

      const result = await job.syncUserBalance('GABC');

      expect(result.changed).toBe(true);
      expect(result.currentXlm).toBe('200.0000000');
      expect(result.previousXlm).toBe('100.0000000');
      expect(userRepo.update).toHaveBeenCalledWith(
        { walletAddress: 'GABC' },
        expect.objectContaining({ updatedAt: expect.any(Date) }),
      );
    });

    it('reports no change when balance is unchanged', async () => {
      accountManager.getAccountInfo.mockResolvedValue({
        accountId: 'GABC',
        balances: [{ asset_type: 'native', balance: '100.0000000' }],
        subentryCount: 0,
        sequence: '1',
      });
      userRepo.findOne.mockResolvedValue({ walletAddress: 'GABC', xlmBalance: '100.0000000' });

      const result = await job.syncUserBalance('GABC');

      expect(result.changed).toBe(false);
      expect(userRepo.update).not.toHaveBeenCalled();
    });

    it('treats missing xlmBalance as 0 (stale state correction)', async () => {
      accountManager.getAccountInfo.mockResolvedValue({
        accountId: 'GABC',
        balances: [{ asset_type: 'native', balance: '50.0000000' }],
        subentryCount: 0,
        sequence: '1',
      });
      userRepo.findOne.mockResolvedValue({ walletAddress: 'GABC' });

      const result = await job.syncUserBalance('GABC');

      expect(result.previousXlm).toBe('0');
      expect(result.changed).toBe(true);
    });

    it('retries on transient failure and succeeds', async () => {
      const accountInfo = {
        accountId: 'GABC',
        balances: [{ asset_type: 'native', balance: '10.0000000' }],
        subentryCount: 0,
        sequence: '1',
      };
      accountManager.getAccountInfo
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValue(accountInfo);
      userRepo.findOne.mockResolvedValue(null);
      userRepo.update.mockResolvedValue({});

      jest.useFakeTimers();
      const syncPromise = job.syncUserBalance('GABC');
      await jest.runAllTimersAsync();
      const result = await syncPromise;

      expect(accountManager.getAccountInfo).toHaveBeenCalledTimes(2);
      expect(result.currentXlm).toBe('10.0000000');
      jest.useRealTimers();
    });

    it('throws after exhausting all retries', async () => {
      accountManager.getAccountInfo.mockRejectedValue(new Error('persistent error'));

      jest.useFakeTimers();
      const syncPromise = job.syncUserBalance('GABC');
      await jest.runAllTimersAsync();

      await expect(syncPromise).rejects.toThrow('persistent error');
      expect(accountManager.getAccountInfo).toHaveBeenCalledTimes(4); // 1 + 3 retries
      jest.useRealTimers();
    });
  });

  describe('syncAllWalletBalances', () => {
    it('processes all active users with wallets', async () => {
      const qb = makeQb([
        { walletAddress: 'GABC' },
        { walletAddress: 'GDEF' },
      ]);
      userRepo.createQueryBuilder.mockReturnValue(qb);
      accountManager.getAccountInfo.mockResolvedValue({
        accountId: 'G',
        balances: [{ asset_type: 'native', balance: '0' }],
        subentryCount: 0,
        sequence: '1',
      });
      userRepo.findOne.mockResolvedValue(null);
      userRepo.update.mockResolvedValue({});

      await job.syncAllWalletBalances();

      expect(accountManager.getAccountInfo).toHaveBeenCalledTimes(2);
    });
  });
});
