import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountManagerService, AccountInfo } from '../stellar/account/account-manager.service';
import { User } from '../users/entities/user.entity';
import { LowBalanceAlertService } from './low-balance-alert.service';

/** Periodically evaluates connected wallets so alerts do not depend on a trade request. */
@Injectable()
export class LowBalanceAlertJob {
  private readonly logger = new Logger(LowBalanceAlertJob.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly accountManagerService: AccountManagerService,
    private readonly lowBalanceAlertService: LowBalanceAlertService,
  ) {}

  @Cron('*/5 * * * *', { name: 'wallet-low-balance-alerts', timeZone: 'UTC' })
  async checkWalletBalances(): Promise<{ checked: number; alerted: number; failed: number }> {
    const users = await this.userRepository.find({
      select: { id: true, walletAddress: true },
      where: { isActive: true },
    } as any);
    let alerted = 0;
    let failed = 0;

    for (const user of users) {
      if (!user.walletAddress) continue;
      try {
        const account = await this.accountManagerService.getAccountInfo(user.walletAddress);
        const balance = this.toWalletBalance(account);
        const result = await this.lowBalanceAlertService.checkAndAlert({
          userId: user.id,
          walletAddress: user.walletAddress,
          balance,
        });
        if (result.alerted) alerted++;
      } catch (error) {
        failed++;
        this.logger.warn(
          `Unable to evaluate wallet ${user.walletAddress}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const checked = users.filter((user) => Boolean(user.walletAddress)).length;
    this.logger.log(`Low-balance scan completed: checked=${checked} alerted=${alerted} failed=${failed}`);
    return { checked, alerted, failed };
  }

  private toWalletBalance(account: AccountInfo) {
    const native = account.balances.find((balance) => balance.asset_type === 'native');
    return {
      available: native?.balance ?? '0',
      locked: '0',
      total: native?.balance ?? '0',
      asset: 'XLM',
    };
  }
}
