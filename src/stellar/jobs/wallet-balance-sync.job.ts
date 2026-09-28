import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { AccountManagerService } from '../account/account-manager.service';

export interface BalanceSyncResult {
  walletAddress: string;
  previousXlm: string;
  currentXlm: string;
  changed: boolean;
  syncedAt: Date;
}

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

@Injectable()
export class WalletBalanceSyncJob {
  private readonly logger = new Logger(WalletBalanceSyncJob.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly accountManager: AccountManagerService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async syncAllWalletBalances(): Promise<void> {
    const users = await this.userRepository
      .createQueryBuilder('u')
      .select(['u.id', 'u.walletAddress'])
      .where('u.walletAddress IS NOT NULL')
      .andWhere('u.isActive = true')
      .getMany();

    this.logger.log(`Starting wallet balance sync for ${users.length} users`);

    const results = await Promise.allSettled(
      users.map((u) => this.syncUserBalance(u.walletAddress!)),
    );

    const changed = results.filter(
      (r) => r.status === 'fulfilled' && r.value.changed,
    ).length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    this.logger.log(
      `Wallet sync complete — changed: ${changed}, failed: ${failed}/${users.length}`,
    );
  }

  async syncUserBalance(walletAddress: string): Promise<BalanceSyncResult> {
    const accountInfo = await this.fetchWithRetry(walletAddress);
    const currentXlm =
      accountInfo.balances.find((b) => b.asset_type === 'native')?.balance ?? '0';

    const user = await this.userRepository.findOne({ where: { walletAddress } });
    const previousXlm: string = (user as any)?.xlmBalance ?? '0';
    const changed = previousXlm !== currentXlm;

    if (changed) {
      this.logger.log(
        `Balance change for ${walletAddress}: ${previousXlm} → ${currentXlm} XLM`,
      );
      await this.userRepository.update({ walletAddress }, { updatedAt: new Date() } as any);
    }

    return { walletAddress, previousXlm, currentXlm, changed, syncedAt: new Date() };
  }

  private async fetchWithRetry(
    walletAddress: string,
    attempt = 0,
  ): Promise<Awaited<ReturnType<AccountManagerService['getAccountInfo']>>> {
    try {
      return await this.accountManager.getAccountInfo(walletAddress);
    } catch (error) {
      if (attempt >= MAX_RETRIES) {
        this.logger.error(
          `Sync failed for ${walletAddress} after ${MAX_RETRIES} retries: ${(error as Error).message}`,
        );
        throw error;
      }
      const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
      this.logger.warn(
        `Sync attempt ${attempt + 1} failed for ${walletAddress}, retrying in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
      return this.fetchWithRetry(walletAddress, attempt + 1);
    }
  }
}
