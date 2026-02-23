import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Referral, ReferralStatus } from './entities/referral.entity';
import { User } from '../users/entities/user.entity';
import { Trade, TradeStatus } from '../trades/entities/trade.entity';
import { ReferralStatsDto } from './dto/referral-stats.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);
  private readonly MIN_TRADE_VALUE_USD = 10;

  constructor(
    @InjectRepository(Referral)
    private referralRepository: Repository<Referral>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Trade)
    private tradeRepository: Repository<Trade>,
    private eventEmitter: EventEmitter2,
  ) {}

  generateReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  async getUserReferralCode(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'username', 'walletAddress'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Generate code from wallet address for consistency
    const hash = (user.walletAddress || '').slice(-8).toUpperCase();
    return hash.replace(/[^A-Z0-9]/g, '').padEnd(8, '2');
  }

  async claimReferral(
    userId: string,
    referralCode: string,
  ): Promise<Referral> {
    // Check if user already claimed a referral
    const existingClaim = await this.referralRepository.findOne({
      where: { referredId: userId },
    });

    if (existingClaim) {
      throw new BadRequestException('User already claimed a referral code');
    }

    // Find referrer by code
    const referrer = await this.findUserByReferralCode(referralCode);

    if (!referrer) {
      throw new BadRequestException('Invalid referral code');
    }

    // Prevent self-referral
    if (referrer.id === userId) {
      throw new BadRequestException('Cannot refer yourself');
    }

    // Create referral record
    const referral = this.referralRepository.create({
      referrerId: referrer.id,
      referredId: userId,
      referralCode,
      status: ReferralStatus.PENDING,
    });

    await this.referralRepository.save(referral);

    this.logger.log(
      `Referral claimed: ${userId} referred by ${referrer.id} with code ${referralCode}`,
    );

    return referral;
  }

  async checkAndRewardReferral(tradeId: string): Promise<void> {
    const trade = await this.tradeRepository.findOne({
      where: { id: tradeId },
      relations: ['user'],
    });

    if (!trade || trade.status !== TradeStatus.SETTLED) {
      return;
    }

    // Check if this is user's first completed trade
    const previousTrades = await this.tradeRepository.count({
      where: {
        userId: trade.userId,
        status: TradeStatus.SETTLED,
      },
    });

    if (previousTrades !== 1) {
      return; // Not first trade
    }

    // Check trade value meets minimum
    const tradeValue = parseFloat(trade.totalValue);
    if (tradeValue < this.MIN_TRADE_VALUE_USD) {
      this.logger.log(
        `Trade ${tradeId} value ${tradeValue} below minimum ${this.MIN_TRADE_VALUE_USD}`,
      );
      return;
    }

    // Find pending referral
    const referral = await this.referralRepository.findOne({
      where: {
        referredId: trade.userId,
        status: ReferralStatus.PENDING,
      },
      relations: ['referrer'],
    });

    if (!referral) {
      return;
    }

    // Update referral status
    referral.status = ReferralStatus.COMPLETED;
    referral.firstTradeId = tradeId;
    await this.referralRepository.save(referral);

    // Distribute reward
    await this.distributeReward(referral);
  }

  private async distributeReward(referral: Referral): Promise<void> {
    try {
      // In production, this would interact with Stellar SDK to send XLM
      // For now, we'll simulate the reward distribution
      const rewardAmount = parseFloat(referral.rewardAmount);

      this.logger.log(
        `Distributing ${rewardAmount} XLM reward to referrer ${referral.referrerId}`,
      );

      // Simulate transaction hash
      const txHash = `SIMULATED_TX_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      referral.status = ReferralStatus.REWARDED;
      referral.rewardedAt = new Date();
      referral.rewardTxHash = txHash;
      await this.referralRepository.save(referral);

      // Emit event for notifications
      this.eventEmitter.emit('referral.rewarded', {
        referrerId: referral.referrerId,
        referredId: referral.referredId,
        amount: rewardAmount,
        txHash,
      });

      this.logger.log(`Reward distributed successfully: ${txHash}`);
    } catch (error) {
      this.logger.error(`Failed to distribute reward: ${error}`);
      throw error;
    }
  }

  async getReferralStats(userId: string): Promise<ReferralStatsDto> {
    const referralCode = await this.getUserReferralCode(userId);

    const referrals = await this.referralRepository.find({
      where: { referrerId: userId },
      relations: ['referred'],
      order: { createdAt: 'DESC' },
    });

    const totalInvites = referrals.length;
    const successfulConversions = referrals.filter(
      (r) => r.status === ReferralStatus.REWARDED,
    ).length;
    const pendingReferrals = referrals.filter(
      (r) => r.status === ReferralStatus.PENDING,
    ).length;

    const totalEarnings = referrals
      .filter((r) => r.status === ReferralStatus.REWARDED)
      .reduce((sum, r) => sum + parseFloat(r.rewardAmount), 0)
      .toFixed(7);

    return {
      referralCode,
      totalInvites,
      successfulConversions,
      pendingReferrals,
      totalEarnings,
      referrals: referrals.map((r) => ({
        id: r.id,
        referredUsername: r.referred.username,
        status: r.status,
        rewardAmount: r.rewardAmount,
        createdAt: r.createdAt,
        rewardedAt: r.rewardedAt,
      })),
    };
  }

  private async findUserByReferralCode(code: string): Promise<User | null> {
    // Since we generate codes from wallet addresses, we need to find matching user
    const users = await this.userRepository.find({
      select: ['id', 'username', 'walletAddress'],
    });

    for (const user of users) {
      const userCode = await this.getUserReferralCode(user.id);
      if (userCode === code) {
        return user;
      }
    }

    return null;
  }
}
