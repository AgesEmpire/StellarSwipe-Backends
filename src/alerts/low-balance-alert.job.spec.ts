import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { AccountManagerService } from '../stellar/account/account-manager.service';
import { LowBalanceAlertJob } from './low-balance-alert.job';
import { LowBalanceAlertService } from './low-balance-alert.service';

describe('LowBalanceAlertJob', () => {
  const userRepository = { find: jest.fn() };
  const accountManagerService = { getAccountInfo: jest.fn() };
  const lowBalanceAlertService = { checkAndAlert: jest.fn() };
  let job: LowBalanceAlertJob;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        LowBalanceAlertJob,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: AccountManagerService, useValue: accountManagerService },
        { provide: LowBalanceAlertService, useValue: lowBalanceAlertService },
      ],
    }).compile();
    job = module.get(LowBalanceAlertJob);
    userRepository.find.mockResolvedValue([
      { id: 'user-1', walletAddress: 'GONE' },
      { id: 'user-2', walletAddress: undefined },
      { id: 'user-3', walletAddress: 'GTWO' },
    ]);
    accountManagerService.getAccountInfo
      .mockResolvedValueOnce({ balances: [{ asset_type: 'native', balance: '4' }] })
      .mockRejectedValueOnce(new Error('Horizon unavailable'));
    lowBalanceAlertService.checkAndAlert.mockResolvedValue({ alerted: true });
  });

  it('checks connected active wallets and continues after a provider error', async () => {
    const result = await job.checkWalletBalances();

    expect(result).toEqual({ checked: 2, alerted: 1, failed: 1 });
    expect(accountManagerService.getAccountInfo).toHaveBeenCalledTimes(2);
    expect(lowBalanceAlertService.checkAndAlert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      walletAddress: 'GONE',
      balance: expect.objectContaining({ available: '4', asset: 'XLM' }),
    }));
  });

  it('uses zero when Horizon does not return a native balance', async () => {
    userRepository.find.mockResolvedValue([{ id: 'user-1', walletAddress: 'GONE' }]);
    accountManagerService.getAccountInfo.mockResolvedValue({ balances: [] });
    lowBalanceAlertService.checkAndAlert.mockResolvedValue({ alerted: false });

    await job.checkWalletBalances();

    expect(lowBalanceAlertService.checkAndAlert).toHaveBeenCalledWith(expect.objectContaining({
      balance: expect.objectContaining({ available: '0', total: '0' }),
    }));
  });

  it('does not query users without a wallet address', async () => {
    userRepository.find.mockResolvedValue([{ id: 'user-2', walletAddress: undefined }]);
    const result = await job.checkWalletBalances();
    expect(result).toEqual({ checked: 0, alerted: 0, failed: 0 });
    expect(accountManagerService.getAccountInfo).not.toHaveBeenCalled();
  });
});
