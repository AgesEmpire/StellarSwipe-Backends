import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSubscription, SubscriptionStatus } from '../entities/user-subscription.entity';

export interface AccessCheckResult {
  hasAccess: boolean;
  reason: string;
  subscription?: UserSubscription;
  signalLimit?: number | null;
}

@Injectable()
export class AccessControlService {
  private readonly logger = new Logger(AccessControlService.name);

  constructor(
    @InjectRepository(UserSubscription)
    private readonly subscriptionRepo: Repository<UserSubscription>,
  ) {}

  /**
   * Check whether a user has access to signals from a given provider.
   * Returns the highest-priority active subscription if multiple exist.
   */
  async checkAccess(userId: string, providerId: string): Promise<AccessCheckResult> {
    const subscription = await this.subscriptionRepo
      .createQueryBuilder('sub')
      .leftJoinAndSelect('sub.tier', 'tier')
      .where('sub.userId = :userId', { userId })
      .andWhere('sub.providerId = :providerId', { providerId })
      .andWhere('sub.status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere('sub.periodEnd > NOW()')
      .orderBy('tier.price', 'DESC') // pick the most expensive if multiple
      .getOne();

    if (!subscription) {
      return {
        hasAccess: false,
        reason: 'No active subscription found for this provider',
      };
    }

    return {
      hasAccess: true,
      reason: 'Active subscription found',
      subscription,
      signalLimit: subscription.tier?.signalLimit ?? null,
    };
  }

  /**
   * Check whether a user can view a specific signal.
   * Free signals (from FREE tiers) are always accessible.
   * Premium signals require an active subscription.
   */
  async canUserViewSignal(
    userId: string,
    providerId: string,
    signalTierLevel?: string,
  ): Promise<{ allowed: boolean; reason: string }> {
    // FREE signals are visible to everyone
    if (!signalTierLevel || signalTierLevel === 'FREE') {
      return { allowed: true, reason: 'Free signal - no subscription required' };
    }

    const result = await this.checkAccess(userId, providerId);

    if (!result.hasAccess) {
      return { allowed: false, reason: result.reason };
    }

    return { allowed: true, reason: 'Access granted via active subscription' };
  }

  /**
   * Revoke access for all subscribers of a tier when the provider cancels it.
   */
  async revokeAccessForTier(tierId: string, reason: string): Promise<number> {
    const result = await this.subscriptionRepo.update(
      {
        tierId,
        status: SubscriptionStatus.ACTIVE,
      },
      {
        status: SubscriptionStatus.CANCELLED,
        cancellationReason: reason,
        cancelledAt: new Date(),
        autoRenew: false,
      },
    );

    const affected = result.affected ?? 0;
    this.logger.log(`Revoked access for ${affected} subscribers of tier ${tierId}: ${reason}`);
    return affected;
  }

  /**
   * Suspend access after payment failure (up to 3 retries).
   */
  async suspendSubscription(subscriptionId: string, reason: string): Promise<void> {
    await this.subscriptionRepo.update(subscriptionId, {
      status: SubscriptionStatus.SUSPENDED,
      lastFailureReason: reason,
    });
    this.logger.warn(`Subscription ${subscriptionId} suspended: ${reason}`);
  }

  /**
   * Restore a suspended subscription after successful payment.
   */
  async restoreSubscription(subscriptionId: string): Promise<void> {
    await this.subscriptionRepo.update(subscriptionId, {
      status: SubscriptionStatus.ACTIVE,
      paymentFailureCount: 0,
      lastFailureReason: undefined,
    });
    this.logger.log(`Subscription ${subscriptionId} restored to ACTIVE`);
  }

  /**
   * List all active subscribers for a provider (used by the provider dashboard).
   */
  async getActiveSubscribersForProvider(providerId: string): Promise<UserSubscription[]> {
    return this.subscriptionRepo.find({
      where: { providerId, status: SubscriptionStatus.ACTIVE },
      relations: ['tier', 'user'],
      order: { createdAt: 'DESC' },
    });
  }
}
