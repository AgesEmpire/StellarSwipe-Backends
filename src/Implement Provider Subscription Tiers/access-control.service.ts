import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSubscription, SubscriptionStatus } from '../entities/user-subscription.entity';

@Injectable()
export class AccessControlService {
  private readonly logger = new Logger(AccessControlService.name);

  constructor(
    @InjectRepository(UserSubscription)
    private readonly subscriptionRepo: Repository<UserSubscription>,
  ) {}

  /**
   * Check whether a user has access to signals from a specific provider/tier.
   */
  async canAccessSignal(params: {
    userId: string;
    providerId: string;
    requiredTierId?: string;
  }): Promise<{ allowed: boolean; reason?: string }> {
    const { userId, providerId, requiredTierId } = params;

    const now = new Date();
    const subscription = await this.subscriptionRepo
      .createQueryBuilder('sub')
      .innerJoinAndSelect('sub.tier', 'tier')
      .where('sub.user_id = :userId', { userId })
      .andWhere('tier.provider_id = :providerId', { providerId })
      .andWhere('sub.status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere('sub.current_period_end > :now', { now })
      .orderBy('tier.price', 'DESC') // prefer highest tier if multiple
      .getOne();

    if (!subscription) {
      return { allowed: false, reason: 'No active subscription for this provider' };
    }

    // If a specific tier is required, check tier hierarchy by price
    if (requiredTierId && subscription.tierId !== requiredTierId) {
      const requiredTier = subscription.tier;
      if (requiredTier && subscription.tier.price < requiredTier.price) {
        return { allowed: false, reason: 'Current tier does not include this signal' };
      }
    }

    // Check signal limit
    if (subscription.tier.signalLimit !== null) {
      const signalsAccessedToday = await this.countSignalsAccessedToday(userId, providerId);
      if (signalsAccessedToday >= subscription.tier.signalLimit) {
        return { allowed: false, reason: `Daily signal limit (${subscription.tier.signalLimit}) reached` };
      }
    }

    return { allowed: true };
  }

  /**
   * Grant access by ensuring subscription is active.
   */
  async grantAccess(subscriptionId: string): Promise<void> {
    await this.subscriptionRepo.update(subscriptionId, {
      status: SubscriptionStatus.ACTIVE,
    });
    this.logger.log(`Access granted for subscription ${subscriptionId}`);
  }

  /**
   * Revoke access by suspending or expiring a subscription.
   */
  async revokeAccess(
    subscriptionId: string,
    reason: 'payment_failure' | 'cancelled' | 'expired',
  ): Promise<void> {
    const status =
      reason === 'cancelled'
        ? SubscriptionStatus.CANCELLED
        : reason === 'expired'
          ? SubscriptionStatus.EXPIRED
          : SubscriptionStatus.SUSPENDED;

    await this.subscriptionRepo.update(subscriptionId, { status });
    this.logger.log(`Access revoked for subscription ${subscriptionId}. Reason: ${reason}`);
  }

  /**
   * Get all active subscriptions for a user.
   */
  async getUserActiveSubscriptions(userId: string): Promise<UserSubscription[]> {
    return this.subscriptionRepo.find({
      where: { userId, status: SubscriptionStatus.ACTIVE },
      relations: ['tier'],
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async countSignalsAccessedToday(userId: string, providerId: string): Promise<number> {
    // In a real implementation, track signal access events in a separate table
    // and count today's accesses. For now, return 0.
    return 0;
  }
}
